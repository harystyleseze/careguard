# Agent Spending Summary — API Example (`GET /agent/spending`)

This guide documents the response shape of the spending summary endpoint so third-party consumers can build their own reporting or dashboards on top of it. It's the same endpoint the dashboard's Overview tab uses to render current spend and budget remaining.

---

## Overview

`GET /agent/spending` returns a snapshot of the care recipient's spending policy, month-to-date spend by category, remaining budget, and the most recent transactions. It does not require a payment (it's not an x402-protected route) but it does require authentication.

---

## Authentication

This endpoint is under the `/agent` prefix, which requires the `AGENT_API_KEY` bearer token — not a per-caregiver token. Send it as a standard `Authorization: Bearer` header:

```bash
curl -i "http://localhost:3000/agent/spending" \
  -H "Authorization: Bearer $AGENT_API_KEY"
```

If `AGENT_API_KEY` is unset on the server, requests are allowed through unauthenticated in non-production environments only; in production, an unset key causes every request to this endpoint to be rejected. If the key is set and the request is missing or wrong, the server responds `401 Unauthorized` with a `WWW-Authenticate: Bearer` header.

---

## Sample Request

```bash
curl -s "http://localhost:3000/agent/spending" \
  -H "Authorization: Bearer $AGENT_API_KEY" | jq
```

---

## Sample Response

```json
{
  "policy": {
    "dailyLimit": 100,
    "monthlyLimit": 800,
    "medicationMonthlyBudget": 300,
    "billMonthlyBudget": 500,
    "approvalThreshold": 75,
    "holdTimeSeconds": 0,
    "toolFees": {
      "comparePharmacyPrices": 0.002,
      "auditBill": 0.01,
      "checkDrugInteractions": 0.001
    },
    "notifications": {
      "email": false,
      "sms": false
    }
  },
  "spending": {
    "medications": 42.50,
    "bills": 120.00,
    "serviceFees": 0.083,
    "total": 162.583
  },
  "budgetRemaining": {
    "medications": 257.50,
    "bills": 380.00
  },
  "transactionCount": 14,
  "recentTransactions": [
    {
      "id": "tx-1730212345678",
      "timestamp": "2026-08-28T14:32:05.123Z",
      "type": "medication",
      "description": "Medication: Lisinopril from CVS Pharmacy",
      "amount": 12.49,
      "recipient": "CVS Pharmacy",
      "stellarTxHash": "a1b2c3d4e5f6...",
      "status": "completed",
      "category": "medications"
    }
  ]
}
```

---

## Response Fields

### `policy`

The care recipient's current spending policy — the same values configurable via `POST /agent/policy`. See [Spending Policy for Caregivers](../guides/spending-policy-for-caregivers.md) for what each field controls in practice.

| Field | Type | Description |
|---|---|---|
| `dailyLimit` | number | Maximum total USD the agent can spend across all categories in a single day. |
| `monthlyLimit` | number | Maximum total USD the agent can spend across all categories in a calendar month. |
| `medicationMonthlyBudget` | number | Sub-limit within `monthlyLimit` reserved for medication purchases. |
| `billMonthlyBudget` | number | Sub-limit within `monthlyLimit` reserved for bill payments. |
| `approvalThreshold` | number | Payments at or above this USD amount require caregiver approval before the agent proceeds. |
| `holdTimeSeconds` | number | Seconds a payment is held before settling, giving the caregiver a window to cancel it. `0` means no hold. |
| `toolFees` | object | Per-tool USD fee charged for paid data queries (pharmacy price comparison, bill audit, drug interaction check), keyed by tool name. |
| `notifications` | object | Whether email/SMS alerts are enabled, and the configured address/number if so. |

### `spending`

Month-to-date totals, reset at the start of each calendar month.

| Field | Type | Description |
|---|---|---|
| `spending.medications` | number | Total USD spent on medication orders this month, rounded to 2 decimal places. |
| `spending.bills` | number | Total USD spent on bill payments this month, rounded to 2 decimal places. |
| `spending.serviceFees` | number | Total USD spent on paid data queries this month (price comparisons, bill audits, interaction checks), rounded to 4 decimal places since individual fees are sub-cent. |
| `spending.total` | number | Sum of `medications` + `bills` + `serviceFees`, rounded to 2 decimal places. |

### `budgetRemaining`

Convenience fields computed as `policy` budget minus `spending` for that category — a positive number is remaining headroom, a negative number means the category is already over budget.

| Field | Type | Description |
|---|---|---|
| `budgetRemaining.medications` | number | `medicationMonthlyBudget - spending.medications`. |
| `budgetRemaining.bills` | number | `billMonthlyBudget - spending.bills`. |

Note there is no `budgetRemaining` entry for service fees or for the overall `monthlyLimit` — compute those yourself as `policy.monthlyLimit - spending.total` if you need a global figure.

### Other top-level fields

| Field | Type | Description |
|---|---|---|
| `transactionCount` | number | Total number of transactions recorded for this care recipient (not limited to this month). |
| `recentTransactions` | array | The 5 most recent transactions, newest last. Each entry follows the same shape as rows returned by `GET /agent/transactions` — see that endpoint if you need full pagination over the complete history rather than just the last 5. |

Each transaction in `recentTransactions` has: `id`, `timestamp` (ISO 8601), `type` (`medication`, `bill`, or `service_fee`), `description`, `amount`, `recipient`, `status`, `category`, and optionally `stellarTxHash` (a 64-character hex Stellar transaction hash, present once the payment settles and the hash could be extracted) and `txHashStatus` (`extraction_failed` if a hash could not be recovered from the payment receipt).

---

## Error Responses

### `401 Unauthorized` — missing or invalid API key

```json
{
  "error": "Unauthorized: Invalid AGENT_API_KEY"
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

## Related reading

- [Spending Policy for Caregivers](../guides/spending-policy-for-caregivers.md) — what each policy field means and how holds/approvals work
- [Category Budgets Examples](../guides/category-budgets-examples.md) — worked examples of budget math
- [OpenAPI Spec](../openapi.yml) — full API schema
