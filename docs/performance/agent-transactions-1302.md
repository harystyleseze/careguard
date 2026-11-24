# Performance investigation: GET /agent/transactions (#1302)

Run the reproducible benchmark with:

```bash
npm run benchmark:transactions
```

Set `BENCHMARK_ITERATIONS` (default 500) to change the per-scenario sample
size. The script measures the handler's work — paginating the stored history
(`shared/transaction-pagination.ts`) and JSON-serialising the response — with
synthetic transactions shaped like `TransactionSchema`. It excludes network and
Express overhead, which are constant per request.

## How the endpoint works

`server.ts` serves `GET /agent/transactions` from the in-memory spending
tracker. The history is stored oldest-first; the handler slices one page
(newest-first) using `limit` (default 25) and `offset` (default 0) and returns
it with `pagination: { total, limit, offset, hasMore, hasPrevious }`. The slice
is O(page size), so **per-request cost depends on the page returned, not on the
total history** — provided the page size is bounded.

It wasn't: `limit` was unbounded, so `?limit=<huge>` serialised the entire
history in one response. The dashboard's full-history export did exactly that
(`limit=pagination.total`).

## Results

Sample run (x86_64 macOS laptop, Node 26, 500 samples per scenario). Absolute
timings vary by machine; the scaling is what matters.

| Stored | Scenario | p50 | p95 | p99 | Payload |
|---:|---|---:|---:|---:|---:|
| 100 | limit=25 (default) | 0.009 ms | 0.024 ms | 0.039 ms | 8.5 KB |
| 100 | limit=500 (max) | 0.077 ms | 0.107 ms | 0.227 ms | 33.5 KB |
| 100 | unbounded (pre-fix) | 0.075 ms | 0.104 ms | 0.223 ms | 33.4 KB |
| 1,000 | limit=25 (default) | 0.008 ms | 0.019 ms | 0.023 ms | 8.5 KB |
| 1,000 | limit=500 (max) | 0.136 ms | 0.280 ms | 0.428 ms | 167.3 KB |
| 1,000 | unbounded (pre-fix) | 0.798 ms | 1.097 ms | 1.347 ms | 334.2 KB |
| 10,000 | limit=25 (default) | 0.012 ms | 0.034 ms | 0.053 ms | 8.5 KB |
| 10,000 | limit=500 (max) | 0.144 ms | 0.423 ms | 0.559 ms | 167.7 KB |
| 10,000 | unbounded (pre-fix) | 9.143 ms | 10.882 ms | 12.722 ms | 3,350.8 KB |

## Findings

- **Pagination exists and is effective when used.** The default page stays at
  ~8.5 KB and ~0.05 ms p99 regardless of history size (100 → 10,000).
- **Unbounded requests scale linearly and are the real risk.** At 10,000
  transactions a single unbounded request is ~3.3 MB and ~13 ms p99 of
  synchronous JSON serialisation on the event loop, blocking every other
  request for that time — and it grows without limit as history accumulates.
- ~335 bytes per transaction, so 10,000 transactions (~14 months at 24/day) is
  already multi-megabyte.

## Changes made

- `MAX_TRANSACTIONS_LIMIT = 500`: larger `limit` values are clamped. This caps
  a single response at ~170 KB and well under 1 ms p99 at any history size.
  Negative `limit`/`offset` are clamped to 0; `limit=0` still returns an empty
  page (#1073).
- The dashboard's full-history export now walks pages of 500 until
  `hasMore` is false instead of requesting everything at once.

## Recommendations (not done here)

- **Indexing is not needed for this endpoint**: there is no filtering, and page
  slicing is O(page size) on an in-memory array.
- **Persistence is the next scaling limit**: a JSONL transaction log already
  exists, but `saveSpending` (`agent/tools.ts`) still rewrites the legacy
  full-history JSON file and the snapshot on every save, i.e. O(n) bytes per
  recorded transaction. Once external tooling no longer needs the legacy file,
  drop that write and rely on the JSONL log, so saves are O(1) appends.
- `agent/server.ts` (the standalone agent server) still returns the full
  tracker from `/agent/transactions` without pagination. If it is deployed,
  reuse `paginateTransactions` there too.
