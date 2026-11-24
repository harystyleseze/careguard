# Performance investigation: issues #1323, #1325, and #1327

Run the reproducible benchmark with:

```bash
npm run benchmark:investigations
```

Set `BENCHMARK_ITERATIONS` to change the per-call sample size. Results vary by
CPU and filesystem, so the script prints measurements instead of committing
machine-specific timings.

## #1323 — network mode

Call sites are `agent/tools.ts` (startup validation and outbound tool branches),
`shared/x402-signer.ts`, and `shared/stellar-network.ts`. `isMockNetwork` does
not read a file or perform I/O: it compares `env.MOCK_NETWORK` with `"1"`.
`assertMockNetworkAllowed` performs the same comparison and a second env lookup.
There is no cache today, but the check is synchronous and O(1); caching it would
add lifecycle complexity without removing meaningful work from an outbound call.

The benchmark reports per-call cost and extrapolates naturally to the number of
checks in an agent run. Recommendation: keep the current implementation and
avoid a startup cache unless profiling shows unusually high check counts.

## #1325 — pharmacy pricing

`getPharmacyPrices` normalizes the drug name and performs an in-memory object
lookup. It has no cache and therefore no TTL or cache-hit metric. “Cold” and
“warm” calls exercise the same path; the benchmark reports both, plus a mixed
popular/long-tail workload. Because the source data is static in process, adding
a TTL cache would increase memory and invalidation complexity without reducing
the existing lookup cost. Recommendation: do not add a cache for this data
source; add one only if the implementation becomes a remote provider.

## #1327 — journal scaling

> **Update (#1068):** `agent/journal.ts` had no production callers and has been
> removed, together with its benchmark. Spending persistence uses the snapshot +
> `transactions.jsonl` path in `agent/tools.ts`. The findings below are kept as a
> historical record.

`agent/journal.ts` uses synchronous filesystem operations and JSONL storage.
Appends are `appendFileSync` calls. Reads replay the whole journal by reading,
splitting, parsing, and applying every line. Compaction is configured by the
caller and defaults to 100 entries; the benchmark disables compaction so the
requested 1k/10k/100k growth points remain observable.

The benchmark reports append and replay timings at all three sizes. Replay is
the scaling-sensitive path. Recommendation: retain the existing snapshot and
compaction design, and lower/tune the threshold if production journals approach
the 100k range; consider a streamed parser or embedded store only if measured
replay latency becomes operationally significant.
