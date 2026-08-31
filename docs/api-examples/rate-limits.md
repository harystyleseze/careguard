# API Rate Limits

This guide documents current rate-limit behavior for CareGuard's public
endpoints — the pharmacy and bill-audit routes most third-party consumers
integrate against — including the `429` response shape and how to back off
correctly.

---

## Summary

Every rate limiter in CareGuard shares one fixed **60-second window**. There
is no way to change the window length — only the number of requests allowed
inside it. Limits are enforced per-process, in memory (not shared across
instances).

| Endpoint | Policy | Default limit (per 60s) | Env var |
|---|---|---|---|
| `GET /pharmacy/compare` | `pharmacy_compare` | 30 | `RATE_LIMIT_PHARMACY_COMPARE` |
| `POST /pharmacy/order` | `pharmacy_order` | 10 | `RATE_LIMIT_PHARMACY_ORDER` |
| `POST /pharmacy/prices` (admin) | `default` | 60 | not independently configurable |
| `POST /bill/audit` | `bill_audit` | 20 | `RATE_LIMIT_BILL_AUDIT` |
| `GET /drug/interactions` | `drug_interactions` | 30 | `RATE_LIMIT_DRUG_INTERACTIONS` |
| `POST /agent/run` | `agent_run` | 5 | `RATE_LIMIT_AGENT_RUN` |
| Everything else (fallback) | `default` | 60 | not configurable |

These are the operator-configured defaults for a self-hosted CareGuard
instance; a given deployment may run with different values (see "How to
check the limit that actually applies," below). Source of truth:
[`shared/rate-limit.ts`](../../shared/rate-limit.ts).

> **Note on `/pharmacy/order`:** this table describes the route as mounted
> on the unified server (`server.ts`), which is the endpoint documented in
> [`docs/openapi.yml`](../openapi.yml). If you are instead calling the
> standalone pharmacy-payment service directly
> ([`services/pharmacy-payment/server.ts`](../../services/pharmacy-payment/server.ts))
> on its own port, no rate limiter is currently applied there — do not
> assume the same protection exists on both paths.

---

## Rate-limit response headers

Every response — not just `429`s — carries standard rate-limit headers,
since limiting is configured with `standardHeaders: true`:

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | Maximum requests allowed in the current window. |
| `RateLimit-Remaining` | Requests remaining in the current window. |
| `RateLimit-Reset` | Seconds until the window resets. |

A rejected request additionally includes:

| Header | Meaning |
|---|---|
| `Retry-After` | Seconds to wait before retrying. Always present on a `429`. |

Legacy `X-RateLimit-*` headers are **not** sent (`legacyHeaders: false`) —
use the `RateLimit-*` names above.

---

## The 429 error shape

A rate-limited request receives an HTTP `429` with the same JSON error
envelope used across CareGuard's API (see
[`docs/api/error-schema.md`](../api/error-schema.md)):

```json
{
  "error": "Too many requests, please try again later.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 60
RateLimit-Limit: 30
RateLimit-Remaining: 0
RateLimit-Reset: 42

{
  "error": "Too many requests, please try again later.",
  "code": "RATE_LIMIT_EXCEEDED"
}
```

`code` is always `RATE_LIMIT_EXCEEDED` regardless of which policy rejected
the request — use the response headers, not the body, to see how close you
were to the limit and when it resets.

---

## Retry and backoff guidance

1. **Always read `Retry-After` before retrying.** It reports the remaining
   window length in seconds and is the authoritative signal — don't guess
   or hardcode a delay.
2. **Back off exponentially on repeated 429s.** A single 429 usually means
   you can retry once `Retry-After` elapses. Seeing consecutive 429s across
   several windows means your request rate is structurally too high for the
   policy — increase your own client-side interval rather than retrying
   immediately every time.
3. **Money-moving and payload-heavy routes are intentionally the tightest.**
   `pharmacy_order` (10/min) and `agent_run` (5/min) are deliberately
   conservative because they gate on-chain payment submission and
   LLM-bound work respectively. Do not build a retry loop that hammers
   these routes — space out order submissions client-side instead of
   relying on the server to throttle you gracefully.
4. **`pharmacy_compare` and `drug_interactions` have more headroom** (30/min
   each) since they are read-only and cheap. If you are batching many
   comparisons, prefer spacing requests over the 60-second window rather
   than bursting.
5. **A `429` never partially applies a request.** Rate limiting rejects the
   request before any handler runs, so a rejected `/bill/audit` or
   `/pharmacy/order` call has no side effects — it is always safe to retry
   after the backoff window.
6. **Limits are per-process**, not per-API-key or per-consumer. If you share
   a CareGuard instance with other integrations, your effective quota can be
   consumed by traffic that isn't yours — plan for lower effective
   throughput than the table above in a shared deployment.

---

## How to check the limit that actually applies

Because thresholds are operator-configurable via environment variables, the
values in the table above are defaults, not guarantees for any specific
deployment. Inspect the `RateLimit-Limit` header on any response from the
instance you're integrating with — it always reflects the value the process
is actually running with:

```bash
curl -s -o /dev/null -D - "https://api.careguard.xyz/pharmacy/compare?drug=Lisinopril" | grep -i ratelimit
```

---

## Related reading

- [`shared/rate-limit.ts`](../../shared/rate-limit.ts) — source of every
  policy, default, and env var referenced here
- [`docs/api/error-schema.md`](../api/error-schema.md) — the shared error
  envelope, including the `429` contract
- [`docs/runbooks/rate-limit-tuning.md`](../runbooks/rate-limit-tuning.md) —
  operator guide for reading rate-limit metrics and safely changing
  thresholds
- [`docs/api-examples/pharmacy-compare.md`](pharmacy-compare.md) — full
  request/response example including a `429` case
- [`docs/openapi.yml`](../openapi.yml) — full API schema, including the
  `429` response on every rate-limited route
