# ADR: Unified vs Split Server Architecture

**Status:** Accepted (short-term mitigation applied; long-term split recommended)  
**Date:** 2026-06-28  
**Issues:** [#237](https://github.com/harystyleseze/careguard/issues/237)

---

## Context

`server.ts` mounts five independent service domains on a single Express port:

| Route prefix | Domain | Cost profile |
|---|---|---|
| `/pharmacy/compare` | Pharmacy price comparison (x402) | Low CPU, network I/O |
| `/bill/audit` | Medical bill audit (x402) | Low CPU, large payloads (up to 256 KB) |
| `/drug/interactions` | Drug interaction check (x402) | Very low CPU |
| `/pharmacy/order` | MPP payment processing | Network + Stellar I/O |
| `/agent/run` | LLM agentic loop | High CPU, high latency (5–30 s) |

The single shared rate limiter meant that a burst on one route (e.g. bill audits) consumed capacity from the shared `default` bucket, potentially starving lower-latency routes such as `/agent/run`.

---

## Decision

### Short-term: per-route rate limiters with independent token buckets

Each route now has its own rate-limit bucket (configured in `shared/rate-limit.ts` as `perRouteLimiters`). A spike on `/bill/audit` cannot consume the `/agent/run` budget. Limits are tunable via environment variables:

| Env var | Default | Route |
|---|---|---|
| `RATE_LIMIT_AGENT_RUN` | 5 req/min | `POST /agent/run` |
| `RATE_LIMIT_BILL_AUDIT` | 20 req/min | `POST /bill/audit` |
| `RATE_LIMIT_PHARMACY_COMPARE` | 30 req/min | `GET /pharmacy/compare` |
| `RATE_LIMIT_DRUG_INTERACTIONS` | 30 req/min | `GET /drug/interactions` |
| `RATE_LIMIT_PHARMACY_ORDER` | 10 req/min | `POST /pharmacy/order` |

A `route_concurrent_requests{route}` Prometheus gauge is also emitted so operators can observe in-flight concurrency per route and alert on sustained saturation.

### Long-term: split into per-service containers behind a gateway

The dev-mode architecture (`npm run services`) already runs each service in its own process. For production:

1. Deploy each service (pharmacy, bill-audit, drug-interaction, pharmacy-payment, agent) as its own container/Render service.
2. Put a gateway (Nginx, Caddy, or a lightweight Express reverse proxy) in front to route on path prefix.
3. Each service scales independently — agent replicas can autoscale based on queue depth while pharmacy-compare stays at a single small instance.
4. This matches the `docker-compose.yml` model already present in the repo.

This long-term split is tracked as a follow-up and is **not** part of this PR. The per-route limiters are a safe, reversible mitigation that reduces blast radius without requiring infrastructure changes.

---

## Consequences

**Positive:**
- Noisy-neighbor risk reduced immediately without operational changes.
- Limits are observable (Prometheus) and configurable (env vars).
- No breaking change to client APIs.

**Negative:**
- Five separate in-process rate-limit stores; under very high traffic, memory usage increases slightly (one counter array per route per window).
- Does not solve CPU/event-loop saturation from long-running LLM calls — a separate worker process is the correct fix for that, tracked in the long-term split above.

---

## Alternatives Considered

- **Single global rate limit with higher ceiling:** Rejected — does not prevent cross-route starvation.
- **Redis-backed rate limiting:** Preferred for multi-instance deployments. The existing `rate-limit-redis` dependency supports this; enabling it requires setting `REDIS_URL`. Not activated here because the current deployment is single-instance.
- **Worker threads for LLM agent:** Deferred to long-term split.
