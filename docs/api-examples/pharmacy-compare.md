# Pharmacy Price Comparison — API Example (`GET /pharmacy/compare`)

This guide shows a complete curl request/response cycle for the pharmacy price-comparison endpoint, including the x402 payment header flow.

---

## Overview

The `GET /pharmacy/compare` endpoint compares medication prices across partnered pharmacies. It costs **$0.002 USDC** per request via the x402 protocol on Stellar.

> For general x402 setup, see [docs/setup/x402.md](../setup/x402.md). For a conceptual overview of x402 payments, see [paying-with-x402.md](paying-with-x402.md).

---

## Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `drug` | Yes | `string` (1–80 chars) | Medication name to compare |
| `dosage` | No | `string` (1–80 chars) | Dosage string (e.g. `10mg`) |
| `zip` | No | `string` (5 digits) | 5-digit ZIP code for distance adjustments |

---

## Step 1: Initial Request (no payment)

```bash
curl -i "http://localhost:3000/pharmacy/compare?drug=Lisinopril&dosage=10mg"
```

The server responds with **402 Payment Required** and a challenge body:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "payTo": "GA...RECIPIENT_STELLAR_ADDRESS",
      "price": "$0.002",
      "asset": "USDC"
    }
  ],
  "error": "Payment required to access /pharmacy/compare"
}
```

The challenge tells you:
- Which Stellar network to use
- The payee address
- The exact amount and asset to pay

---

## Step 2: Retry with `X-Payment` Header

After constructing a signed Stellar authorization entry (see [paying-with-x402.md](paying-with-x402.md) for details), attach it in the `X-Payment` header:

```bash
curl -i "http://localhost:3000/pharmacy/compare?drug=Lisinopril&dosage=10mg" \
  -H "X-Payment: <BASE64_OR_JSON_PAYMENT_PAYLOAD>"
```

---

## Step 3: Successful Response

On success, the server returns **200 OK** with pharmacy price data:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "drug": "lisinopril",
  "dosage": "10mg",
  "prices": [
    {
      "pharmacyId": "cvs-phoenix-01",
      "pharmacyName": "CVS Pharmacy",
      "price": 12.49,
      "inStock": true
    },
    {
      "pharmacyId": "walgreens-downtown-02",
      "pharmacyName": "Walgreens",
      "price": 14.25,
      "inStock": true
    },
    {
      "pharmacyId": "costco-riverside-03",
      "pharmacyName": "Costco Pharmacy",
      "price": 9.99,
      "inStock": true
    }
  ]
}
```

Results are sorted from lowest to highest price.

---

## Error Responses

### `400 Bad Request` — Missing drug parameter

```bash
curl -i "http://localhost:3000/pharmacy/compare?dosage=10mg"
```

```json
{
  "error": "drug is required",
  "code": "VALIDATION_MISSING_FIELD"
}
```

### `404 Not Found` — Drug not found

```json
{
  "error": "Drug not found: nonexistentdrug",
  "code": "NOT_FOUND_DRUG"
}
```

### `429 Too Many Requests`

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

Check the `Retry-After` header and back off before retrying.

---

## SDK Alternative

Instead of manually handling the 402 challenge and retry, use the `@x402/fetch` wrapper:

```typescript
import { wrapFetchWithX402 } from "@x402/fetch";
import { Keypair } from "@stellar/stellar-sdk";

const keypair = Keypair.fromSecret(process.env.CLIENT_STELLAR_SECRET!);
const x402Fetch = wrapFetchWithX402(fetch, { signer: keypair });

const response = await x402Fetch(
  "http://localhost:3000/pharmacy/compare?drug=Lisinopril&dosage=10mg"
);
const data = await response.json();
console.log(data.prices);
```

---

## Related reading

- [Paying with x402](paying-with-x402.md) — full x402 payment flow explanation
- [x402 Setup](../setup/x402.md) — server-side facilitator configuration
- [OpenAPI Spec](../openapi.yml) — full API schema
