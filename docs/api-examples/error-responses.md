# Error Responses — API Reference

CareGuard's API returns errors as JSON using a consistent shape across almost all endpoints. This doc consolidates the actual error JSON you'll see for the most common failure categories — validation, authentication/authorization, and payment-required — lists every HTTP status code used across the API, and gives guidance on which errors are safe to retry.

> For the full list of stable `code` strings and their meanings, see [docs/error-codes.md](../error-codes.md). This doc focuses on the JSON shapes and retry behavior; that one is the canonical registry of codes.

---

## The standard error shape

Most error responses use the shared `Error` schema defined in [docs/openapi.yml](../openapi.yml):

```json
{
  "error": "A human-readable description of the error.",
  "code": "STABLE_MACHINE_READABLE_CODE",
  "details": {}
}
```

| Field | Type | Always present | Description |
|---|---|---|---|
| `error` | `string` | Yes | Human-readable message. Suitable for logs; not guaranteed stable across versions — don't match on its text. |
| `code` | `string` | Yes | Stable, uppercase `SNAKE_CASE` identifier. Safe to branch on programmatically. See [error-codes.md](../error-codes.md) for the full registry. |
| `details` | `object` | No | Structured, code-specific metadata (e.g. which fields failed validation, current spending usage). Omitted when there's nothing structured to add. |

**One exception:** 402 responses from paid (x402) routes do **not** use this shape — see [Payment-required errors](#payment-required-errors-402) below.

---

## Validation errors (400)

Returned when a request payload or query parameters fail schema validation.

```json
{
  "error": "drug is required",
  "code": "VALIDATION_MISSING_FIELD",
  "details": {
    "fields": {
      "drug": ["Required"]
    }
  }
}
```

Common validation codes: `VALIDATION_MISSING_FIELD`, `VALIDATION_INVALID_INPUT`, `VALIDATION_INSUFFICIENT_SCORE` (drug-interaction score too low to proceed). The `details.fields` map, when present, keys each invalid field to its list of validation messages.

## Authentication and authorization errors (401 / 403)

**401 Unauthorized** — no or invalid credentials:

```json
{
  "error": "Missing Authorization header",
  "code": "AUTH_TOKEN_MISSING"
}
```

**403 Forbidden** — credentials present but insufficient, or a CSRF mismatch:

```json
{
  "error": "Admin token required for this endpoint",
  "code": "AUTH_ADMIN_REQUIRED"
}
```

Note that a malformed or revoked token (`AUTH_TOKEN_INVALID`) returns **403**, not 401 — treat both statuses as "re-authenticate," since the distinction is about credential validity, not presence.

## Payment-required errors (402)

CareGuard uses 402 in two distinct ways depending on the endpoint, and they have **different shapes**. Always branch on HTTP status first, then inspect the body according to which kind of route you called.

**x402 paid routes** (e.g. `GET /pharmacy/compare`) return an x402 payment challenge, *not* the shared `Error` schema:

```json
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

There is no `code` field on this shape — clients must detect it by HTTP status `402`, then read `accepts` for the scheme, network, payee, and price to construct a signed payment and retry with an `X-Payment` header. See [pharmacy-compare.md](pharmacy-compare.md) for the full request/response cycle.

**Spending-policy routes** (e.g. agent spend endpoints) return the standard `Error` shape with a `POLICY_*` code when a budget or approval rule blocks the action:

```json
{
  "error": "Requested amount exceeds the monthly medication budget",
  "code": "POLICY_MONTHLY_LIMIT",
  "details": {
    "rule": "medicationMonthlyBudget",
    "limit": 300,
    "currentUsage": 295,
    "requestedAmount": 10,
    "recipient": "Rosa Garcia"
  }
}
```

---

## HTTP status codes used across the API

| Status | Meaning here | Example codes |
|---|---|---|
| `400` | Bad Request — payload/query failed validation | `VALIDATION_MISSING_FIELD`, `VALIDATION_INVALID_INPUT`, `VALIDATION_INSUFFICIENT_SCORE` |
| `401` | Unauthorized — missing/expired credentials | `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_EXPIRED` |
| `402` | Payment Required — x402 challenge (see above) or `POLICY_*` block | `POLICY_DAILY_LIMIT`, `POLICY_MONTHLY_LIMIT`, `POLICY_APPROVAL_REQUIRED`, `POLICY_CATEGORY_BLOCKED`, `PAYMENT_INSUFFICIENT_FUNDS` |
| `403` | Forbidden — credentials present but not sufficient | `AUTH_TOKEN_INVALID`, `AUTH_ADMIN_REQUIRED`, `FORBIDDEN` |
| `404` | Not Found — resource doesn't exist | `NOT_FOUND_DRUG`, `NOT_FOUND_PHARMACY`, `NOT_FOUND_AGENT`, `NOT_FOUND` |
| `409` | Conflict — action blocked by current state | `AGENT_PAUSED`, `POLICY_BLOCKED` |
| `413` | Payload Too Large | `BODY_TOO_LARGE` |
| `429` | Too Many Requests | `RATE_LIMIT_EXCEEDED` |
| `500` | Internal Server Error | `INTERNAL_SERVER_ERROR`, `SERVER_INTERNAL_ERROR`, `PAYMENT_TX_FAILED` |
| `502` | Bad Gateway — upstream dependency failed | `UPSTREAM_HORIZON_DOWN`, `UPSTREAM_LLM_DOWN`, `UPSTREAM_FACILITATOR_DOWN`, `UPSTREAM_FACILITATOR_ERROR`, `PAYMENT_TX_TIMEOUT` |
| `503` | Service Unavailable — degraded/unreachable dependency at boot | `SERVICE_UNAVAILABLE`, `SERVER_DEGRADED` |
| `504` | Gateway Timeout | `UPSTREAM_TIMEOUT` |

The full code-to-status mapping, with operator and client remediation notes, lives in [docs/error-codes.md](../error-codes.md).

---

## Retryable vs non-retryable errors

**Retry (with backoff or after a specific action):**

- **`429 Too Many Requests`** — always retryable. Respect the `Retry-After` header if present, and back off exponentially otherwise.
- **`502`, `503`, `504`** — transient upstream/dependency failures (Stellar Horizon, the LLM provider, the x402 facilitator, or the service being degraded at boot). Retry with backoff; for codes like `UPSTREAM_TIMEOUT` or `PAYMENT_TX_TIMEOUT`, retry with an idempotency key where the endpoint supports one to avoid duplicate side effects.
- **`402` from an x402 route** — retryable *after* attaching a valid `X-Payment` header. This isn't a failure to recover from so much as an expected step in the protocol.
- **`401` with `AUTH_TOKEN_EXPIRED`** — retryable after re-authenticating to obtain a fresh token.

**Do not retry as-is (fix the request or state first):**

- **`400` validation errors** — the payload itself is invalid. Retrying unchanged will fail identically; fix the fields listed in `details.fields`.
- **`401`/`403` other than an expired token** (`AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `AUTH_ADMIN_REQUIRED`, `FORBIDDEN`) — the credentials or permissions are wrong; retrying without changing them will always fail.
- **`404`** — the resource doesn't exist; retrying won't create it.
- **`402` `POLICY_*` codes** — the request exceeds a spending limit or requires caregiver approval. Retrying won't help until the underlying state changes (budget resets, approval is granted, or the request amount is reduced).
- **`409 AGENT_PAUSED`** — the coordinator agent is paused; retrying will keep failing until it's resumed.
- **`413 BODY_TOO_LARGE`** — reduce the payload size; retrying the same body will always fail.
- **`500 INTERNAL_SERVER_ERROR` / `SERVER_INTERNAL_ERROR`** — treat as non-retryable by default. A single retry is reasonable, but repeated failures indicate a server-side bug — stop and report rather than retry-looping.

As a rule of thumb: **5xx and 429 are generally safe to retry with backoff; 4xx generally means fix something before retrying**, with `401`-expired and `402` x402-challenges as the two 4xx exceptions where a scripted retry after a specific corrective step (re-auth, pay) is the expected client behavior.

---

## Related reading

- [Error Codes Registry](../error-codes.md) — canonical list of every `code` string, HTTP status, and remediation steps
- [Pharmacy Price Comparison example](pharmacy-compare.md) — full x402 challenge/retry cycle
- [OpenAPI Spec](../openapi.yml) — `Error` and `X402PaymentChallenge` schema definitions
