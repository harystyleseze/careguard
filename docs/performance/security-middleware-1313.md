# Security middleware chain overhead (#1313)

**Question:** how much per-request latency does the unified server's global security chain add, which middleware in it is expensive, and does the cost compound under concurrent load?

**Benchmark:** [`benchmarks/security-middleware-overhead.ts`](../../benchmarks/security-middleware-overhead.ts) (`npm run benchmark:security-middleware`). It rebuilds the chain from `server.ts` in the same order:

| # | Layer | Source |
|---|---|---|
| 1 | Rate limiters (`agent` on `/agent`, `default` globally) | `shared/rate-limit.ts` |
| 2 | Helmet (CSP, CORP, HSTS in prod) | `shared/security-middleware.ts` |
| 3 | CORS allowlist | `shared/cors.ts` |
| 4 | Path-selected `express.json` body parser | `server.ts` |
| 5 | Request lifecycle (request id, AsyncLocalStorage, pino log per request) | `shared/request-lifecycle.ts` |
| 6 | `requireApiKey` on `/agent` | `shared/auth.ts` |

Sentry is excluded because `initSentry()` is a no-op without `SENTRY_DSN`. The rate limiters use the real `createRateLimiter()` with a very high `max`, so the benchmark measures counting cost rather than 429s. The benchmark runs servers with `NODE_ENV=production`, which means JSON pino logs (sent to `/dev/null`) and HSTS on.

It measures two targets: `GET /health`, and an authenticated `POST /agent/echo` with a small JSON body.

Two modes:
- **Isolated** (`MODE=isolated`): each layer on its own, in-process, invoked directly with an unconnected `IncomingMessage` / `ServerResponse`. This gives each middleware's own CPU cost without socket noise. It answers the per-middleware breakdown.
- **HTTP** (`MODE=http`): cumulative stages 0 to 6, each in its own child process, driven over keep-alive HTTP at concurrency 1, 10 and 50, with the median of 3 rounds. It answers the end-to-end cost and the behaviour under concurrent load.

Environment for the numbers below: Intel i7-7700HQ (4c/8t) laptop, Node v26.2.0, with other workloads running. Treat the numbers as orders of magnitude, not precise figures.

## Per-middleware cost (isolated, 50 000 invocations, p50)

| Layer | GET /health Δ p50 | POST /agent/echo Δ p50 |
|---|---:|---:|
| baseline (bare express + route) | 17.8 µs | 19.4 µs |
| rate limiters | +9.0 µs | +16.2 µs |
| helmet (`security-middleware.ts`) | +6.0 µs | +6.7 µs |
| CORS | +3.2 µs | +4.5 µs |
| JSON body parser | +1.6 µs (no body) | +19.9 µs |
| request lifecycle | +7.2 µs | +4.8 µs |
| `requireApiKey` | ~0 (not mounted on `/health`) | +9.4 µs |
| **full chain** | **+27.0 µs** (44.8 µs total) | **+62.1 µs** (81.5 µs total) |

Mean values follow the same pattern but are noisier, because of GC pauses in the p99 tail. The raw tables are printed by the script.

## End-to-end over HTTP (cumulative, median of 3 rounds)

| Target | Concurrency | Baseline rps / mean | Full chain rps / mean |
|---|---:|---:|---:|
| GET /health | 1 | 4 033 / 0.25 ms | 2 904 / 0.34 ms |
| GET /health | 10 | 9 518 / 1.05 ms | 4 551 / 2.20 ms |
| GET /health | 50 | 12 546 / 3.94 ms | 3 364 / 14.8 ms |
| POST /agent/echo | 1 | 4 875 / 0.21 ms | 2 313 / 0.43 ms |
| POST /agent/echo | 10 | 11 455 / 0.87 ms | 3 273 / 3.05 ms |
| POST /agent/echo | 50 | 10 352 / 4.79 ms | 4 160 / 12.0 ms |

Stage-by-stage HTTP deltas under 0.1 ms were within run-to-run noise on this machine, and some came out negative. That's why the per-middleware attribution above uses the isolated mode.

## Findings

1. **At low load the absolute cost is small.** The full chain adds about 0.1–0.2 ms per request at concurrency 1, which is negligible next to the agent's LLM and Stellar calls, which take hundreds of milliseconds to seconds.
2. **It compounds under concurrency because it's CPU-bound.** The chain costs about 30–60 µs of CPU on every request, and Node runs it on one thread. So peak throughput on these trivial routes drops by roughly 55–75% at concurrency 50, and mean latency rises from about 4–5 ms to about 12–15 ms, because requests queue behind each other's middleware CPU. Heavier real routes would see a smaller relative effect.
3. **`shared/security-middleware.ts` (helmet) itself isn't a hotspot.** It costs about 6–7 µs per request, because the CSP string is built once at startup.
4. **The largest contributors are the rate limiters and the JSON parser**, together roughly 35 µs on `/agent` POSTs, followed by request lifecycle logging and API-key checking.

## Recommendations

1. **Don't run two rate limiters on `/agent`.** `/agent` requests pass through both `rateLimiters.agent` and `rateLimiters.default`, and each does its own key generation and store increment, at about 8–9 µs each. Skip the default limiter for paths an agent limiter already covers, for example by mounting `default` with a `skip: (req) => req.path.startsWith("/agent")` option. This roughly halves the rate-limit cost on agent routes.
2. **Only mount body parsing where there's a body.** `express.json` costs almost nothing on GETs because it bails early, but on POSTs it's the most expensive layer. It's already limited per path. No change is needed beyond keeping it off routes that don't accept JSON.
3. **Make request logging asynchronous in production.** `request-lifecycle` writes one pino line per request synchronously to stdout. Using an async destination (`pino.destination({ sync: false })`) or a pino transport moves that write off the request path. See the related request-logger investigation (#1318, `benchmarks/request-logger-overhead.ts`).
4. **Leave helmet, CORS and `requireApiKey` as they are.** Together they cost about 10–20 µs and provide the core protections. Consolidating them wouldn't save enough to be worth the added complexity.
5. **Scale horizontally for sustained high concurrency.** Because the cost is per-request CPU, extra instances or a cluster of workers help more than micro-optimising any single layer.
