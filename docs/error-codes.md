# CareGuard API Error Codes Registry

This registry lists the stable, machine-readable `code` strings returned in CareGuard JSON error responses.

| Error Code | HTTP Status | Description | Details Payload |
|------------|-------------|-------------|-----------------|
| `VALIDATION_ERROR` | 400 Bad Request | The request payload failed schema validation (e.g., Zod checks). | Mapping of invalid fields to arrays of validation messages under `fields`. |
| `PAYMENT_REQUIRED` | 402 Payment Required | The requested route is paid and requires payment verification via x402 or MPP protocols. | Contains scheme, network, recipient wallet (`payTo`), asset, and price. |
| `POLICY_BLOCKED` | 400 Bad Request / 403 Forbidden / 409 Conflict | The action violates a spending policy limit or rule (e.g., exceeding budget). | Contains standard limit, rule name, requested amount, current usage, and recipient info. |
| `UNAUTHORIZED` | 401 Unauthorized | Missing or invalid auth header (e.g. Bearer Token) or missing/expired caregiver credentials. | None. |
| `FORBIDDEN` | 403 Forbidden | CSRF token mismatch, invalid admin credentials, or insufficient permissions. | None. |
| `NOT_FOUND` | 404 Not Found | The requested resource (recipient, transaction, drug, price record, or route) was not found. | None. |
| `AGENT_PAUSED` | 409 Conflict | The transaction or run cannot proceed because the CareGuard agent is currently paused. | `paused: true` and optionally `pausedReason`. |
| `RATE_LIMIT_EXCEEDED` | 429 Too Many Requests | The client has exceeded rate limiting quotas. | None. |
| `INTERNAL_SERVER_ERROR` | 500 Internal Server Error | An unexpected server or database error occurred. | None. |
| `SERVICE_UNAVAILABLE` | 503 Service Unavailable | A critical dependency (e.g. SQLite, Redis, Horizon, OZ Facilitator) is degraded or unreachable. | List of failing checks (e.g. `{"checks": {"horizon": false}}`). |

---

## Detailed Error Code Specifications

### 1. `VALIDATION_ERROR`
Indicates input parameter or payload schema mismatch.
* **Details Structure**:
  ```json
  {
    "fields": {
      "fieldName.subField": ["Error message 1", "Error message 2"]
    }
  }
  ```

### 2. `PAYMENT_REQUIRED`
Returned when query fees or transaction execution costs must be paid using USDC on Stellar.
* **Details Structure**:
  ```json
  {
    "scheme": "exact",
    "network": "stellar:testnet",
    "payTo": "G...",
    "price": "0.0100000",
    "asset": "USDC"
  }
  ```

### 3. `POLICY_BLOCKED`
Returned when a request is blocked because it exceeds spending limits or budgets.
* **Details Structure**:
  ```json
  {
    "rule": "medicationMonthlyBudget",
    "limit": 300,
    "currentUsage": 295,
    "requestedAmount": 10,
    "recipient": "Rosa Garcia"
  }
  ```

### 4. `AGENT_PAUSED`
Returned when trying to post tasks or execute actions while the coordinator agent is paused.
* **Details Structure**:
  ```json
  {
    "paused": true,
    "pausedReason": "Caregiver manual pause"
  }
  ```
## Registry

| Code | HTTP Status | Meaning | Operator Remediation | Client Remediation |
|------|-------------|---------|---------------------|-------------------|
| `VALIDATION_MISSING_FIELD` | 400 | Required field missing or empty | — | Check request payload |
| `VALIDATION_INVALID_INPUT` | 400 | Input failed schema validation | — | Fix input format |
| `VALIDATION_INSUFFICIENT_SCORE` | 400 | Drug interaction score too low | — | Try different drug combination |
| `AUTH_TOKEN_MISSING` | 401 | No authentication token provided | Verify reverse proxy / middleware config | Include `Authorization` header |
| `AUTH_TOKEN_EXPIRED` | 401 | Token has expired | — | Re-authenticate via login flow |
| `AUTH_TOKEN_INVALID` | 403 | Token is malformed or revoked | Check for credential leaks | Re-authenticate |
| `AUTH_ADMIN_REQUIRED` | 403 | Admin token required for this endpoint | — | Use admin credentials |
| `NOT_FOUND_DRUG` | 404 | Drug name not in formulary | Check pharmacy data sync | Verify drug name spelling |
| `NOT_FOUND_PHARMACY` | 404 | Pharmacy not found | Check pharmacy data sync | Verify pharmacy ID |
| `NOT_FOUND_AGENT` | 404 | Agent config not found | Check agent setup | Reconfigure agent |
| `BODY_TOO_LARGE` | 413 | Request body exceeds size limit | Increase `MAX_BODY_SIZE` if legitimate | Reduce payload size |
| `POLICY_DAILY_LIMIT` | 402 | Daily spending cap reached | Increase cap or wait for reset | Schedule payment for next day |
| `POLICY_MONTHLY_LIMIT` | 402 | Monthly spending cap reached | Increase cap or wait for reset | Schedule payment for next month |
| `POLICY_APPROVAL_REQUIRED` | 402 | Amount exceeds approval threshold | Approve via caregiver dashboard | Request caregiver approval |
| `POLICY_CATEGORY_BLOCKED` | 402 | Category not in budget | Adjust budget categories | Reassign category or adjust budget |
| `PAYMENT_INSUFFICIENT_FUNDS` | 402 | Agent wallet has insufficient USDC/XLM | Fund agent wallet | Fund agent wallet via dashboard |
| `PAYMENT_TX_FAILED` | 500 | Stellar transaction failed | Check Stellar network status and wallet balance | Retry |
| `PAYMENT_TX_TIMEOUT` | 502 | Stellar transaction timed out | Check Horizon RPC availability | Retry with idempotency key |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests | Increase rate limit if legitimate | Back off and retry after `Retry-After` |
| `UPSTREAM_HORIZON_DOWN` | 502 | Stellar Horizon / Soroban RPC unreachable | Check `STELLAR_RPC_URL` and network status | Retry with backoff |
| `UPSTREAM_LLM_DOWN` | 502 | LLM provider (Groq) unreachable or error | Check `LLM_BASE_URL` and API key | Retry; switch to degraded mode |
| `UPSTREAM_FACILITATOR_DOWN` | 502 | OZ x402 facilitator unreachable | Check `X402_FACILITATOR_URL` and API key | Retry; fall back to direct payment |
| `UPSTREAM_FACILITATOR_ERROR` | 502 | OZ facilitator returned error | Review facilitator logs | Retry with backoff |
| `UPSTREAM_TIMEOUT` | 504 | External upstream request timed out | Check upstream health | Retry with backoff |
| `SERVER_DEGRADED` | 503 | Service running in degraded mode (Horizon down at boot) | Check Stellar RPC configuration | Retry later |
| `SERVER_INTERNAL_ERROR` | 500 | Unhandled server error | Check server logs and Sentry | Retry; contact support |

---

## Adding a New Error Code

1. Choose a category prefix from the table above and a `SCREAMING_SNAKE_CASE` specifier.
2. Add the code to this registry with its HTTP status, meaning, and remediations.
3. Add the code to the `Error.code` enum in `docs/openapi.yml`.
4. Use the new code in the server's error response.
5. If the error is user-facing, add a friendly message to the dashboard's error handler.

---

## Cross-References

- `docs/openapi.yml` — `Error.code` field enum (keep in sync with this registry)
- `docs/troubleshooting.md` — operator-facing troubleshooting guide
- `docs/api-examples/error-responses.md` — sample error JSON per category, HTTP status list, and retryable vs non-retryable guidance
