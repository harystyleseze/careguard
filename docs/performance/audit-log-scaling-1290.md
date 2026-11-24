# Audit log scaling (#1290)

**Question:** `shared/audit-log.ts` appends JSONL records and reads the log back for lookups. How does read/append performance degrade as the log grows, and is a database warranted yet?

**Benchmark:** [`benchmarks/audit-log-scaling.ts`](../../benchmarks/audit-log-scaling.ts) — `npm run benchmark:audit-log`.

## Method

Each size is seeded by a direct bulk write rather than through `appendAuditEntry`, which runs at ~275 appends/s (measured below) and would take the better part of an hour to drive 1M entries through the real path. The seeder reproduces the exact hash chain `appendAuditEntry` builds, so a real append on top links onto the last seeded record instead of falling back to the genesis hash. Operations are then measured at that size.

Read paths are measured **before** any append runs. `rotateLogs()` fires on every append and renames the file away once it reaches `MAX_FILE_SIZE`, so a read measured after an append on a >10 MiB file would silently observe a nearly empty file. (This was a real bug in the first draft of this benchmark: it reported 1.3 ms for the 1M read because the file had already been rotated away.)

Read paths are measured on a file grown past the rotation threshold with rotation bypassed, so the 100k and 1M rows answer "what if the log were allowed to grow that large" — not "what does production do today". The production bound is measured separately, below.

## Results

Node v24.14.1, Windows dev machine, 200 append samples / 200 `getLastLine` samples / 3 read samples per size.

Absolute numbers move run to run on a shared dev machine — a repeat of the 10k cell measured 4.402 ms append mean and 77.713 ms read against 3.608 ms and 45.081 ms here, roughly 1.5–1.7×. The *shape* is stable across runs, and that is what the findings rest on: append and `getLastLine` flat across a 100× size range, read cost linear in entries. Treat the absolute figures as indicative, not as a baseline to regress against.

| entries | active size | append mean | append p95 | append p99 | append/s | `getLastLine` p95 | `GET /agent/audit` p95 | read peak RSS | rotation | rotations during 200 appends |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 2.68 MiB | 3.608 ms | 4.440 ms | 5.956 ms | 268 | 1.418 ms | 45.081 ms | 93 MiB | 13.947 ms | 0 |
| 100,000 | 26.88 MiB | 3.686 ms | 4.595 ms | 12.930 ms | 254 | 1.380 ms | 407.261 ms | 334 MiB | 14.068 ms | 1 |
| 1,000,000 | 269.78 MiB | 3.549 ms | 4.745 ms | 8.932 ms | 264 | 1.388 ms | 4379.222 ms | 1114 MiB | 14.084 ms | 1 |

### Production bound

45,000 appends with rotation enabled, as the code actually runs:

> active file **1.58 MiB (6,122 entries)**, **1 archive**, 152.4 s total, **295 appends/s**

## Findings

1. **`getLastLine` is not a full-file read.** The issue describes it as reading the whole file back; it does not. It seeks backwards from the tail in 1 KiB chunks until it finds a newline, so it is O(1) in file size — measured p95 is 1.418 / 1.380 / 1.388 ms across a 100× size range. The ~1.4 ms floor is per-call syscall overhead (`statSync` + `openSync`/`readSync`/`closeSync`), not I/O volume.

2. **`appendAuditEntry` is also flat in file size** — 3.608 / 3.686 / 3.549 ms mean, ~275 appends/s regardless of whether the file holds 10k or 1M entries. Cost is dominated by `lock.lockSync` (which creates and removes a lockfile directory), `getLastLine`, one SHA-256, and `appendFileSync` — all O(1). **~275 appends/s is therefore a hard throughput ceiling, and it is a rate limit, not a size limit.** It will not improve as the log grows, and it is the number to watch.

3. **The genuinely O(n) path is `GET /agent/audit`,** which does `readFileSync` + `JSON.parse` on every line + a full sort, then slices one page: 45 ms at 10k → 407 ms at 100k → **4.4 s at 1M**, with peak RSS 93 → 334 → **1114 MiB**. Memory is the sharper cliff than latency — 1.1 GB resident to serve 50 rows. This path, not `getLastLine`, is what a database would fix.

4. **Rotation costs a flat ~14 ms and is size-independent** (13.947 / 14.068 / 14.084 ms). It is a fixed cascade of up to 12 `renameSync` calls plus a `statSync`, and because `rotateLogs()` runs on *every* append, the whole cost model is a fixed ~3.6 ms append plus an occasional ~14 ms rotation. Note the p99 jump at 100k (12.930 ms): that is the single rotation landing inside the sample window, not size-dependent cost.

5. **Rotation already caps the active file at 10 MiB, so the read path is bounded in production.** After 45,000 appends the active file held only 6,122 entries. In production `GET /agent/audit` therefore parses at most ~37k entries (~170 ms, ~130 MB RSS), and total retained history is capped at 13 × 10 MiB = 130 MiB. The 1M row is a *hypothetical* — what the code would do if `MAX_FILE_SIZE` were raised — not current behaviour.

## Recommendation: no database yet

The JSONL design is self-limiting. Both operations the issue asks about are O(1) in file size, and `MAX_FILE_SIZE` already bounds the one path that is not. A database would not make appends faster — the ~275/s ceiling is `proper-lockfile`'s synchronous lock, which a database would not remove — so migrating now would trade a bounded 130 MiB of files for new operational cost for no measured gain.

Revisit the decision when **any** of these hold:

- **`MAX_FILE_SIZE` is raised above ~50 MiB** (≈190k entries). The read path extrapolates to ~800 ms and ~600 MB RSS, and the handler has no tail-read or index to fall back on. This is the primary trigger.
- **Retention must span archives.** The route only ever reads the active file, so the previous 12 archives are currently unqueryable through the API. Needing to search across them means an index, which means a database.
- **Sustained append rate exceeds ~275/s.** Then the fix is the synchronous lock (batched or async appends, or an in-process ring buffer flushed to JSONL), not necessarily a database.
- **Multiple processes must append.** The lock is cooperative and file-based, so it is correct, but every append pays ~3.6 ms of lock churn on shared storage.

### Cheaper wins available now, no migration required

1. **`GET /agent/audit` should read the tail, not the whole file.** Results are sorted newest-first and the common request is page 1 — reading the last few hundred KB backwards and parsing only what is needed turns 45 ms into ~1 ms at 10k, and removes the 1.1 GB RSS cliff entirely. This is the single highest-value change and it is a contained edit to one handler.
2. **Cache the `statSync` in `getLastLine`/`rotateLogs`.** Both stat the file on every append for no reason the size check cannot amortise; ~1.4 ms of the ~3.6 ms append is this syscall pair.
3. **Hoist the rotation check out of the per-append path** — check size on a timer or every N appends instead of on every call, so the 14 ms cascade is not in the request path when it does fire.
