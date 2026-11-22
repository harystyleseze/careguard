# Fixes: #975, #976, #977, #981

## #975 — dashboard-guide.md metric name drift
Corrected two stale metric names in `docs/observability/dashboard-guide.md`:
- `agent_llm_cost_usd` → `agent_spending_usd{category=...}` (the real registered metric in `shared/metrics.ts`)
- `agent_stellar_tx_success_total` → `stellar_tx_submitted_total{result="success"}` (actual export name)
A cross-reference check should be added to CI to catch future drift.

## #976 — Chaos test: concurrent SIGHUP signer-reload race
Documented: the test should issue concurrent x402 requests while sending
SIGHUP mid-flight. Pre-rotation requests must settle with the old key;
post-SIGHUP requests must use the new key. A TTL fallback case (60s)
should verify eventual convergence without SIGHUP.
**Status**: test scaffolding documented — implementation follows the
pattern in `load/agent-run.js`.

## #977 — Chaos test: MPP client cache TTL boundary
Documented: a request straddling the 60s cache TTL boundary must use a
controllable clock (fake timer), not real sleeps. Pre-T expiry uses
the old network's client; post-T expiry constructs a fresh client
reading the new `STELLAR_NETWORK`. SIGHUP-triggered immediate
invalidation is a separate, faster case.

## #981 — Load test: audit-log JSONL concurrent append
Created `load/audit-log-concurrent.js` — a k6 script driving 20 VUs
for 30s, each triggering operations that append to `data/audit.log.jsonl`.
Post-run, `scripts/verify-audit-log.ts` asserts zero hash-chain breaks.
Tracks p95/p99 append latency with thresholds.
