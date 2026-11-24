# Paying for CareGuard Endpoints with x402

This guide explains how external API consumers and third-party applications can authenticate and pay for CareGuard's protected endpoints using the **x402 protocol** on the Stellar network.

> [!NOTE]
> This guide is intended for external API consumers calling CareGuard endpoints from their client applications. For internal backend setup and OpenZeppelin Facilitator server configuration, refer to [docs/setup/x402.md](../setup/x402.md).

---

## Overview

CareGuard uses the x402 protocol to gate access to premium data and compute services (such as medical bill auditing and pharmacy price comparisons). Instead of static monthly API subscriptions or API key billing, requests are paid per-call using **USDC on Stellar**.

When a client requests an x402-protected endpoint without a valid payment proof header, CareGuard responds with an `HTTP 402 Payment Required` challenge. The client builds and signs a payment transaction or authorization entry on Stellar, attaches it to the request via the `X-Payment` header, and retries.

---

## Protected Endpoints & Pricing

The following endpoints require x402 micropayments per request:

| Endpoint | Method | Price (USDC) | Description |
|---|---|---|---|
| `/pharmacy/compare` | `GET` | **$0.002** | Compares medication prices across partnered pharmacies |
| `/bill/audit` | `POST` | **$0.01** | Audits line-item hospital bills against Medicare fair-market rates |
| `/drug/interactions` | `GET` | **$0.001** | Checks multi-medication lists for drug-drug interaction risks |

---

## The x402 Payment Flow

```
+--------+                    +------------------+                   +---------------+
| Client |                    | CareGuard Server |                   | Facilitator   |
+---+----+                    +--------+---------+                   +-------+-------+
    |                                  |                                     |
    | 1. GET /pharmacy/compare         |                                     |
    |--------------------------------->|                                     |
    |                                  |                                     |
    | 2. HTTP 402 Payment Required     |                                     |
    |<---------------------------------|                                     |
    |    (Challenge JSON in body)      |                                     |
    |                                  |                                     |
    | 3. Construct & sign Stellar auth |                                     |
    |    entry with user keypair       |                                     |
    |                                  |                                     |
    | 4. GET /pharmacy/compare         |                                     |
    |    Header: X-Payment <payload>   |                                     |
    |--------------------------------->|                                     |
    |                                  | 5. Verify payment proof             |
    |                                  |------------------------------------>|
    |                                  |                                     |
    |                                  | 6. Proof verified (200 OK)          |
    |                                  |<------------------------------------|
    |                                  |                                     |
    | 7. HTTP 200 OK + Response Data   |                                     |
    |<---------------------------------|                                     |
    +                                  +                                     +
```

### Step 1: Initial Request & Receiving HTTP 402

When sending a request to a protected endpoint without payment headers:

```bash
curl -i https://api.careguard.xyz/pharmacy/compare?drug=Lisinopril&dosage=10mg
```

The server responds with `HTTP 402 Payment Required` and a challenge payload outlining payment requirements:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
WWW-Authenticate: x402

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

### Step 2: Constructing and Signing the Authorization Entry

To fulfill the challenge, your client constructs a payment authorization payload containing:
- The target payee (`payTo`) address from the 402 challenge.
- The precise payment amount (e.g. `$0.002`).
- A signed Stellar authorization entry generated using your client's Stellar Keypair.

Using `@x402/stellar` SDK:

```typescript
import { Keypair } from "@stellar/stellar-sdk";
import { ExactStellarScheme } from "@x402/stellar/exact/client";

// Initialize client Stellar keypair
const clientKeypair = Keypair.fromSecret("S...");

// Parse challenge details
const payTo = challenge.accepts[0].payTo;
const network = challenge.accepts[0].network;

// Generate payment payload
const scheme = new ExactStellarScheme();
const paymentPayload = await scheme.createPaymentHeader({
  keypair: clientKeypair,
  payTo,
  amount: "$0.002",
  network,
});
```

### Step 3: Retrying with `X-Payment` Header

Re-issue the original request with the computed payment payload attached in the `X-Payment` header:

```bash
curl -i https://api.careguard.xyz/pharmacy/compare?drug=Lisinopril&dosage=10mg \
  -H "X-Payment: <BASE64_OR_JSON_PAYMENT_PAYLOAD>"
```

CareGuard verifies the payload against the facilitator. Upon successful settlement confirmation, the server processes your query and returns `HTTP 200 OK`:

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
    }
  ]
}
```

---

## SDK Integration (`@x402/fetch`)

Rather than handling 402 responses and retries manually, you can use the `@x402/fetch` wrapper around standard `fetch`. It automatically catches 402 status codes, signs the payment entry, and resends the request seamlessly:

```typescript
import { wrapFetchWithX402 } from "@x402/fetch";
import { Keypair } from "@stellar/stellar-sdk";

const signerKeypair = Keypair.fromSecret(process.env.CLIENT_STELLAR_SECRET!);

// Create an x402-enabled fetch function
const x402Fetch = wrapFetchWithX402(fetch, {
  signer: signerKeypair,
});

// Use x402Fetch like standard fetch
const response = await x402Fetch("https://api.careguard.xyz/pharmacy/compare?drug=Lisinopril&dosage=10mg");
const data = await response.json();
console.log("Pharmacy comparison result:", data);
```

---

## Difference Between Client Integration & Facilitator Setup

It is important to distinguish this document from internal facilitator administration:

| Topic | Consumer Guide (`paying-with-x402.md`) | Facilitator Setup (`x402.md`) |
|---|---|---|
| **Target Audience** | External API developers, third-party integrations | Internal CareGuard DevOps & system administrators |
| **Focus** | How clients pay for API calls via Stellar | How backend servers configure `OZ_FACILITATOR_API_KEY` |
| **Key Responsibilities** | Signing Stellar authorization entries & passing `X-Payment` | Facilitator health monitoring & environment variables |
