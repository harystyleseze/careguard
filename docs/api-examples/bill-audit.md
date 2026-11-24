# Medical Bill Audit — API Example (`POST /bill/audit`)

This guide shows a complete curl request/response cycle for the medical bill audit endpoint, including the x402 payment header flow.

---

## Overview

The `POST /bill/audit` endpoint compares a medical bill's line items against CMS Medicare fair-market rates and flags duplicates, upcoding, and overcharges. It costs **$0.01 USDC** per audit via the x402 protocol on Stellar.

> For general x402 setup, see [docs/setup/x402.md](../setup/x402.md). For a conceptual overview of x402 payments, see [paying-with-x402.md](paying-with-x402.md).

---

## Request Body

| Field | Required | Type | Description |
|---|---|---|---|
| `lineItems` | Yes | `array` (min 1 item) | The bill's line items |
| `lineItems[].description` | Yes | `string` (1–80 chars) | Human-readable description of the charge |
| `lineItems[].cptCode` | Yes | `string` | CPT code, matching `/^(?:\d{5}\|J\d{4})$/` |
| `lineItems[].quantity` | Yes | `integer` (1–999) | Number of units billed |
| `lineItems[].chargedAmount` | Yes | `number` (0–1,000,000) | Amount charged for this line item |

---

## Step 1: Initial Request (no payment)

```bash
curl -i -X POST "http://localhost:3002/bill/audit" \
  -H "Content-Type: application/json" \
  -d '{
    "lineItems": [
      { "description": "Office visit, complex", "cptCode": "99215", "quantity": 1, "chargedAmount": 1250 },
      { "description": "Complete blood count (CBC)", "cptCode": "85025", "quantity": 1, "chargedAmount": 45 },
      { "description": "Complete blood count (CBC)", "cptCode": "85025", "quantity": 1, "chargedAmount": 45 },
      { "description": "Chest X-ray, 2 views", "cptCode": "71046", "quantity": 1, "chargedAmount": 180 }
    ]
  }'
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
      "payTo": "GA...BILL_PROVIDER_PUBLIC_KEY",
      "price": "$0.01",
      "asset": "USDC"
    }
  ],
  "error": "Payment required to access /bill/audit"
}
```

---

## Step 2: Retry with `X-Payment` Header

After constructing a signed Stellar authorization entry (see [paying-with-x402.md](paying-with-x402.md) for details), attach it in the `X-Payment` header and resend the same body:

```bash
curl -i -X POST "http://localhost:3002/bill/audit" \
  -H "Content-Type: application/json" \
  -H "X-Payment: <BASE64_OR_JSON_PAYMENT_PAYLOAD>" \
  -d '{
    "lineItems": [
      { "description": "Office visit, complex", "cptCode": "99215", "quantity": 1, "chargedAmount": 1250 },
      { "description": "Complete blood count (CBC)", "cptCode": "85025", "quantity": 1, "chargedAmount": 45 },
      { "description": "Complete blood count (CBC)", "cptCode": "85025", "quantity": 1, "chargedAmount": 45 },
      { "description": "Chest X-ray, 2 views", "cptCode": "71046", "quantity": 1, "chargedAmount": 180 }
    ]
  }'
```

---

## Step 3: Successful Response — findings included

The example bill above has three problems: the office visit and the X-ray are both charged well above their CMS fair rates (upcoding), and the CBC line item appears twice — the first is itself an overcharge, and the repeat is flagged as a duplicate. The server returns **200 OK**:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "auditTimestamp": "2026-08-30T14:12:03.000Z",
  "protocol": {
    "name": "x402",
    "network": "stellar:testnet",
    "price": "$0.01",
    "payTo": "GA...BILL_PROVIDER_PUBLIC_KEY"
  },
  "totalCharged": 1520,
  "totalCorrect": 390,
  "totalOvercharge": 1130,
  "savingsPercent": 74.3,
  "errorCount": 4,
  "lineItems": [
    {
      "description": "Office visit, complex",
      "cptCode": "99215",
      "quantity": 1,
      "chargedAmount": 1250,
      "fairMarketRate": 265,
      "status": "upcoded",
      "errorDescription": "Charged $1250 — CMS fair market rate is $265. Overcharged by $985.00.",
      "suggestedAmount": 318
    },
    {
      "description": "Complete blood count (CBC)",
      "cptCode": "85025",
      "quantity": 1,
      "chargedAmount": 45,
      "fairMarketRate": 15,
      "status": "overcharged",
      "errorDescription": "Charged $45 — CMS fair market rate is $15. Overcharged by $30.00.",
      "suggestedAmount": 18
    },
    {
      "description": "Complete blood count (CBC)",
      "cptCode": "85025",
      "quantity": 1,
      "chargedAmount": 45,
      "fairMarketRate": 15,
      "status": "duplicate",
      "errorDescription": "Duplicate charge for CPT 85025. Appears 2 times.",
      "suggestedAmount": 0
    },
    {
      "description": "Chest X-ray, 2 views",
      "cptCode": "71046",
      "quantity": 1,
      "chargedAmount": 180,
      "fairMarketRate": 45,
      "status": "upcoded",
      "errorDescription": "Charged $180 — CMS fair market rate is $45. Overcharged by $135.00.",
      "suggestedAmount": 54
    }
  ],
  "dataFreshness": {
    "ratesAsOf": "2026-01-01",
    "validUntil": "2026-12-31",
    "isStale": false
  },
  "recommendation": "Found 4 errors totaling $1130 in overcharges (74.3% of total bill). Strongly recommend filing a formal dispute."
}
```

Each line item's `status` is one of:

- `"upcoded"` — charged more than 3x the fair rate (suggests a wrong billing code)
- `"overcharged"` — charged more than 1.5x the fair rate
- `"duplicate"` — a repeat occurrence of a CPT code already seen earlier in the bill (outside the allowlisted codes, e.g. therapy codes billed per session); the duplicate check runs before the overcharge check, so a repeat is always flagged as `"duplicate"` even if it would also be an overcharge
- `"valid"` — within threshold, or the CPT code has no fair-rate entry so it passes through unmodified

Only the repeat occurrence of a duplicated CPT code is flagged `"duplicate"` — the first occurrence is still checked normally against the overcharge/upcoding thresholds, as shown above.

---

## Error Responses

### `400 Bad Request` — Invalid line item

```json
{
  "error": "Request body must contain a valid lineItems array",
  "code": "INVALID_BILL_AUDIT_REQUEST",
  "details": {
    "issues": [
      { "path": "lineItems.0.cptCode", "message": "cptCode must match /^(?:\\d{5}|J\\d{4})$/" }
    ]
  }
}
```

### `413 Payload Too Large`

```json
{
  "error": "Request body too large",
  "code": "BODY_TOO_LARGE",
  "details": { "limit": 262144 }
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

const response = await x402Fetch("http://localhost:3002/bill/audit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    lineItems: [
      { description: "Office visit, complex", cptCode: "99215", quantity: 1, chargedAmount: 1250 },
    ],
  }),
});
const data = await response.json();
console.log(data.recommendation);
```

---

## Related reading

- [Bill Audit Service internals](../services/bill-audit.md) — fair-rate lookup semantics and audit thresholds
- [Paying with x402](paying-with-x402.md) — full x402 payment flow explanation
- [x402 Setup](../setup/x402.md) — server-side facilitator configuration
- [OpenAPI Spec](../openapi.yml) — full API schema
