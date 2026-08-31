# Pharmacy Order & MPP Payment — API Example (`POST /pharmacy/order`)

This guide walks external API consumers through submitting a medication order and completing payment via **MPP Charge** — the payment protocol used specifically for `/pharmacy/order`. It is a separate flow from x402, which protects the read-only `/pharmacy/compare`, `/bill/audit`, and `/drug/interactions` endpoints.

> [!NOTE]
> This guide covers the consumer-facing request/response cycle. For how MPP challenge state and order records are persisted server-side, see [docs/services/mpp.md](../services/mpp.md).

---

## Overview

`POST /pharmacy/order` submits a medication order and pays the pharmacy a real USDC amount on Stellar via **MPP (Machine Payments Protocol) charge mode**. Unlike x402, which uses a stateless `X-Payment` header per request, MPP charge mode is a two-step challenge/response flow tied to a specific order: the server issues a payment challenge, the client signs a Soroban authorization entry against that exact challenge, and re-submits.

### Request body

| Field | Required | Type | Description |
|---|---|---|---|
| `drug` | Yes | `string` (1–80 chars) | Medication name. |
| `pharmacy` | Yes | `string` (1–80 chars) | Pharmacy name. |
| `amount` | Yes | `number` or numeric `string`, `0.01`–`10000` | Order total in USD, paid in USDC. |

---

## The MPP Payment Flow

```
Client                          CareGuard Pharmacy Payment Service         Stellar
  |                                        |                                  |
  | 1. POST /pharmacy/order                |                                  |
  |    { drug, pharmacy, amount }          |                                  |
  |--------------------------------------->|                                  |
  |                                        | No prior challenge for this      |
  |                                        | request                          |
  | 2. 402 Payment Required                |                                  |
  |    X-Payment-Challenge header          |                                  |
  |<---------------------------------------|                                  |
  |                                        | (challenge state persisted to    |
  |                                        |  data/mpp-store.json)            |
  |                                        |                                  |
  | 3. Sign Soroban auth entry             |                                  |
  |    against the challenge               |                                  |
  |                                        |                                  |
  | 4. POST /pharmacy/order (retry)        |                                  |
  |    X-Payment-Authorization header      |                                  |
  |--------------------------------------->|                                  |
  |                                        | 5. Broadcast USDC transfer ------|--> Stellar testnet
  |                                        | 6. Order saved to orders.json    |
  | 7. 200 OK + order confirmation         |                                  |
  |<---------------------------------------|                                  |
```

---

## Step 1: Initial Request (no payment attached)

```bash
curl -i -X POST "http://localhost:3005/pharmacy/order" \
  -H "Content-Type: application/json" \
  -d '{"drug": "Amoxicillin", "pharmacy": "CVS Pharmacy", "amount": 12.50}'
```

Since no payment authorization has been provided yet, the server responds with `402 Payment Required` and an `X-Payment-Challenge` header describing what needs to be signed:

```http
HTTP/1.1 402 Payment Required
X-Payment-Challenge: <encoded challenge payload>
Content-Type: application/json

{
  "requires": "payment"
}
```

The challenge is scoped to this specific order (drug, pharmacy, and amount) and is persisted server-side so the flow survives a server restart between steps 2 and 4 — see [MPP Charge Service — Persistence Model](../services/mpp.md) for how that works internally.

---

## Step 2: Sign the Soroban Authorization Entry

Using the challenge details, your client constructs and signs a Soroban authorization entry for the exact payment amount, payee, and asset (USDC on Stellar testnet) named in the challenge. This is conceptually similar to signing an x402 payment payload, but produced by the MPP client SDK rather than `@x402/stellar`. Consult your MPP client library's documentation for the exact signing call, since the SDK surface differs from `@x402/fetch`.

---

## Step 3: Retry with `X-Payment-Authorization`

Re-submit the same order with the signed authorization attached:

```bash
curl -i -X POST "http://localhost:3005/pharmacy/order" \
  -H "Content-Type: application/json" \
  -H "X-Payment-Authorization: <signed authorization payload>" \
  -d '{"drug": "Amoxicillin", "pharmacy": "CVS Pharmacy", "amount": 12.50}'
```

The server verifies the authorization against the stored challenge, broadcasts the USDC transfer on Stellar, and — only once the payment settles — persists the order.

---

## Step 4: Order-Confirmed Response

On success, the server returns `200 OK` with the confirmed order and a human-readable settlement message:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "success": true,
  "order": {
    "id": "order-1735500000000",
    "drug": "Amoxicillin",
    "pharmacy": "CVS Pharmacy",
    "amount": 12.5,
    "status": "confirmed",
    "timestamp": "2026-08-29T10:00:00.000Z",
    "network": "stellar:testnet",
    "protocol": "MPP Charge"
  },
  "message": "Payment of $12.5 USDC settled on Stellar. Amoxicillin order from CVS Pharmacy confirmed."
}
```

| Field | Description |
|---|---|
| `order.id` | Unique order identifier, prefixed `order-`. |
| `order.status` | Always `"confirmed"` for a 200 response — the order is only created after payment settles. |
| `order.network` | The Stellar network the payment settled on (`stellar:testnet` in the default configuration). |
| `order.protocol` | Always `"MPP Charge"`, distinguishing this payment path from x402. |

You can later retrieve all confirmed orders via `GET /pharmacy/orders`, which returns `{ "orders": [...] }`.

---

## Error Responses

### `400 Bad Request` — validation error

```json
{
  "error": "Invalid order request",
  "details": ["amount must be at least $0.01"]
}
```

Common causes: `amount` below `0.01` or above `10000`, or a missing/empty `drug` or `pharmacy`.

### `503 Service Unavailable` — facilitator unreachable

```json
{
  "error": "Payment facilitator unavailable, try again shortly"
}
```

Returned if the MPP charge flow itself fails to run (for example, the Stellar facilitator can't be reached). No order is created and no funds move in this case — retry the original (unsigned) request to get a fresh challenge.

### `429 Too Many Requests`

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

Check the `Retry-After` header and back off before retrying.

---

## Difference From x402

| | `/pharmacy/order` (MPP Charge) | `/pharmacy/compare`, `/bill/audit`, `/drug/interactions` (x402) |
|---|---|---|
| **Purpose** | Real medication order payment | Micropayment to access a paid data query |
| **Challenge header** | `X-Payment-Challenge` | Payment details in the 402 JSON body's `accepts` array |
| **Retry header** | `X-Payment-Authorization` | `X-Payment` |
| **Challenge lifetime** | Persisted server-side per order until fulfilled or expired | Stateless — no server-side challenge storage |
| **Reference doc** | This document, and [MPP persistence model](../services/mpp.md) | [Paying with x402](paying-with-x402.md) |

Do not reuse an x402 client library to talk to `/pharmacy/order` — the header names and challenge/authorization payload shapes are specific to MPP.

---

## Related reading

- [MPP Charge Service — Persistence Model](../services/mpp.md) — internal challenge-state and order persistence details
- [Paying with x402](paying-with-x402.md) — the separate payment protocol used by CareGuard's paid data endpoints
- [OpenAPI Spec](../openapi.yml) — full API schema
