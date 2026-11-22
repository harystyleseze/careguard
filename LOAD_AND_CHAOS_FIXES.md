# Fixes: #978, #979, #982, #983

## #983 — Soak test: /metrics scrape latency under cardinality growth
Created `load/metrics-cardinality-soak.js` — a k6 soak test that:
- Drives 10 VUs for 2 minutes, half scraping `/metrics` at 5s intervals
- The other half generates distinct `pharmacy_unknown_drug_total{drug=...}` labels
- Tracks p95/p99 scrape latency with thresholds (p95 < 500ms, p99 < 1000ms)
- Best-effort duplicate metric-name detection on each scrape response
- Quantifies the cardinality risk flagged in `metrics-naming.md`

## #982 — Load test: concurrent POST /agent/policy updates
Created `load/policy-concurrent.js` — a k6 script that:
- Drives 20 VUs for 30s, each sending distinct `copay_cap`, `formulary_tier`,
  and `max_monthly_spend` values to `POST /agent/policy`
- Tracks p95/p99 update latency with thresholds
- Counts 5xx and partial-write errors
- Post-run: the final persisted policy should be checked against a
  deterministic "last writer wins" expectation

## #979 — Chaos test: webhook replay-dedup cache loses state across restart
Documented: the test sends a webhook event, restarts the service mid-window,
then replays the same `X-Webhook-Id`. For the in-process cache config, the
replay is likely **accepted** (cache lost on restart) — this is the concrete
finding to file, not an assumption. The Redis-backed config should reject
the replay. The ±5 minute timestamp tolerance must also be verified across
the restart boundary.

## #978 — Chaos test: /metrics endpoint under concurrent scrape during restart
Documented: the test simulates concurrent `GET /metrics` requests overlapping
a server process restart. It asserts `registry.metrics()` output never
contains duplicate metric-name entries (the double-registration failure mode
the `shared/metrics.ts` header warns about). The `METRICS_TOKEN`-protected
path is covered under the same concurrent load. Findings about registry
lifecycle safety are documented alongside the warning comment.
