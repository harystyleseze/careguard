# Scaling investigations: issues #1295–#1298

Run the reproducible suite with `npm run benchmark:scaling`.

Results below were collected on 2026-09-25 on Apple Silicon with Node.js 22,
`BENCHMARK_ITERATIONS=200`, and a simulated 20 ms Horizon upstream. Times
measure in-process logic; production network and transport time is additional.

## #1295 — bill audit

| Line items | p95 | p99 |
| ---: | ---: | ---: |
| 10 | 0.039 ms | 0.091 ms |
| 100 | 0.122 ms | 0.728 ms |
| 1,000 | 0.707 ms | 4.629 ms |

`auditBill` is linear: it makes one pass with constant-time CPT and duplicate
lookups. A 1,000-line bill remains below 1 ms here. The existing 256 KB body
limit is sufficient; processing time does not warrant another item-count cap.

## #1296 — drug interactions

The old algorithm was `O(m² × d)` for `m` requested medications and `d`
database pairs. A canonical pair map now makes each request `O(m²)`.

| Database pairs | Indexed p95 / p99 | Scan p95 / p99 |
| ---: | ---: | ---: |
| 100 | 0.004 / 0.015 ms | 0.027 / 0.055 ms |
| 1,000 | 0.001 / 0.004 ms | 0.181 / 0.240 ms |
| 10,000 | 0.004 / 0.043 ms | 1.433 / 2.925 ms |

Keep the map and rebuild it atomically whenever the dataset is refreshed.

## #1297 — adherence history

| History | Records | p95 | p99 |
| --- | ---: | ---: | ---: |
| 1 month | 30 | 0.011 ms | 0.281 ms |
| 6 months | 180 | 0.159 ms | 0.601 ms |
| 24 months | 720 | 0.255 ms | 0.442 ms |

Previously, summary filters repeatedly scanned history and reminder helpers
re-read the JSONL file. One pass now computes all counters and reminder lists,
so `/agent/adherence` reads once. Full history is still recomputed per call;
use incremental per-recipient aggregates if histories reach tens of thousands
of records or endpoint frequency rises substantially.

## #1298 — wallet balance

Call tracing found shared lookups in the wallet endpoint, agent tool, startup
checks, low-balance scheduler, wallet rotation, and setup scripts. Only the
endpoint had a private cache, so other clustered calls caused redundant
Horizon trips.

With a simulated 20 ms upstream, cold p95/p99 was 22.45/28.08 ms and warm p95/
p99 was 0.0003/0.0020 ms. Six concurrent representative lookups completed in
21.23 ms and coalesced to one upstream call. The shared cache defaults to a 5-second TTL, keys by Horizon/
address/issuer, never caches failures, and is configurable through
`WALLET_BALANCE_CACHE_TTL_MS`.
