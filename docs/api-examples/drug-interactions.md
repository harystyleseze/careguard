# Drug Interaction Check — API Example (`GET /drug/interactions`)

This guide shows a complete curl request/response cycle for the drug-interaction-check endpoint, including the x402 payment header flow.

---

## Overview

The `GET /drug/interactions` endpoint checks a list of medications for known pairwise interactions. It costs **$0.001 USDC** per check via the x402 protocol on Stellar — the cheapest of the three x402 endpoints, since it does a single in-memory lookup rather than a multi-pharmacy comparison or a full bill audit.

> For general x402 setup, see [docs/setup/x402.md](../setup/x402.md). For a conceptual overview of x402 payments, see [paying-with-x402.md](paying-with-x402.md).

---

## Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `meds` | Yes | `string` (1–1619 chars) | Comma-separated medication names. Each name is limited to 80 characters. |

---

## Step 1: Initial Request (no payment)

```bash
curl -i "http://localhost:3003/drug/interactions?meds=Lisinopril,Potassium"
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
      "payTo": "GA...PHARMACY_2_PUBLIC_KEY",
      "price": "$0.001",
      "asset": "USDC"
    }
  ],
  "error": "Payment required to access /drug/interactions"
}
```

---

## Step 2: Retry with `X-Payment` Header

After constructing a signed Stellar authorization entry (see [paying-with-x402.md](paying-with-x402.md) for details), attach it in the `X-Payment` header:

```bash
curl -i "http://localhost:3003/drug/interactions?meds=Lisinopril,Potassium" \
  -H "X-Payment: <BASE64_OR_JSON_PAYMENT_PAYLOAD>"
```

---

## Step 3: Successful Response — interaction flagged

On success, the server returns **200 OK**. This example checks Lisinopril against Potassium, a known severe interaction:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "checkTimestamp": "2026-08-30T14:02:11.000Z",
  "protocol": {
    "name": "x402",
    "network": "stellar:testnet",
    "price": "$0.001",
    "payTo": "GA...PHARMACY_2_PUBLIC_KEY"
  },
  "medications": ["Lisinopril", "Potassium"],
  "interactionCount": 1,
  "severeCount": 1,
  "moderateCount": 0,
  "mildCount": 0,
  "interactions": [
    {
      "drug1": "Lisinopril",
      "drug2": "Potassium",
      "severity": "severe",
      "description": "Lisinopril can increase potassium levels. Taking potassium supplements with ACE inhibitors may cause dangerously high potassium (hyperkalemia).",
      "recommendation": "Monitor potassium levels regularly. Avoid potassium supplements unless directed by physician."
    }
  ],
  "overallRisk": "high",
  "summary": "Found 1 interaction(s): 1 severe, 0 moderate, 0 mild."
}
```

`interactions` is sorted most-severe first. `overallRisk` is `"high"` whenever at least one severe interaction is found, `"moderate"` if the worst is moderate, `"low"` if only mild interactions are found, and `"none"` otherwise.

---

## Step 3 (alternate): Successful Response — no interactions found

Checking a medication list with no known pairwise interactions still returns **200 OK**, but with empty results:

```bash
curl -i "http://localhost:3003/drug/interactions?meds=Lisinopril,Amoxicillin" \
  -H "X-Payment: <BASE64_OR_JSON_PAYMENT_PAYLOAD>"
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "checkTimestamp": "2026-08-30T14:05:47.000Z",
  "protocol": {
    "name": "x402",
    "network": "stellar:testnet",
    "price": "$0.001",
    "payTo": "GA...PHARMACY_2_PUBLIC_KEY"
  },
  "medications": ["Lisinopril", "Amoxicillin"],
  "interactionCount": 0,
  "severeCount": 0,
  "moderateCount": 0,
  "mildCount": 0,
  "interactions": [],
  "overallRisk": "none",
  "summary": "No known interactions found."
}
```

A single-medication list (e.g. `meds=Lisinopril`) is also valid — there is no pair to check, so `interactions` is always empty and `overallRisk` is `"none"`.

---

## Error Responses

### `400 Bad Request` — Missing or invalid `meds` parameter

```bash
curl -i "http://localhost:3003/drug/interactions"
```

```json
{
  "error": "meds is required"
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
  "http://localhost:3003/drug/interactions?meds=Lisinopril,Potassium"
);
const data = await response.json();
console.log(data.interactions);
```

---

## Related reading

- [Paying with x402](paying-with-x402.md) — full x402 payment flow explanation
- [x402 Setup](../setup/x402.md) — server-side facilitator configuration
- [OpenAPI Spec](../openapi.yml) — full API schema
