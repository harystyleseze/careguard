# Performance investigation: validation overhead per agent tool call (#1312)

Run the reproducible benchmark with:

```bash
npm run benchmark:validation
```

Set `BENCHMARK_ITERATIONS` (default 5000) to change the per-scenario sample
size. Audit entries written by the blocklist scenario go to a temporary
`DATA_DIR`, not the repo's `data/`.

## What is actually validated, and where

The issue assumed `shared/task-validation.ts` validates tool-call arguments.
It doesn't — there are two separate validators on the agent path:

| Validator | Runs | Input | Work |
|---|---|---|---|
| `validateTask` — `shared/task-validation.ts` | **once per agent run** (`POST /agent/run`) | caregiver's task string | zod length check + control-char strip, JSON `role` probe, blocklist scan; a blocklist hit appends an audit entry |
| `validateToolInput` — `agent/tool-input-validation.ts` (moved from `agent/tools.ts`, still re-exported there) | **before every tool call** (`executeTool` in `agent/runner.ts`) | LLM-supplied tool arguments | strict zod object schema per tool |

## Are schemas recompiled per call?

**No.** `TaskInputSchema` and every entry of `TOOL_INPUT_SCHEMAS` are built
once at module load and reused; `validateToolInput` only looks the schema up
by tool name and calls `safeParse`. A test
(`agent/__tests__/tool-input-validation.test.ts`) asserts every call goes
through the same cached schema instance.

The benchmark quantifies what that caching is worth: rebuilding the
`compare_pharmacy_prices` schema on every call costs **~111 µs p50** versus
**~0.65 µs** for the cached schema (~170×). No change is needed here.

## Results

Sample run (x86_64 macOS laptop, Node 26, 5,000 samples per scenario;
1,000 for the audit-writing and cumulative scenarios). Absolute timings vary
by machine.

### validateTask (once per run)

| Scenario | p50 | p95 | p99 |
|---|---:|---:|---:|
| typical task (~90 chars) — **before** this PR | 12.20 µs | 17.01 µs | 50.79 µs |
| typical task (~90 chars) — after | 1.59 µs | 4.95 µs | 16.05 µs |
| max-length task (5,000 chars) | 25.95 µs | 30.67 µs | 49.89 µs |
| blocklist hit (+ audit log append) | 657 µs | 909 µs | 1,345 µs |

### validateToolInput (every tool call)

| Scenario | p50 | p95 | p99 |
|---|---:|---:|---:|
| typical: `compare_pharmacy_prices` | 0.58 µs | 2.47 µs | 3.05 µs |
| typical: `pay_bill` | 0.65 µs | 3.71 µs | 18.62 µs |
| worst: `audit_medical_bill`, ~96 KB `line_items_json` | 0.34 µs | 0.63 µs | 1.47 µs |
| ↳ for context: the runner's `JSON.parse` of that string | 340 µs | 569 µs | 989 µs |
| worst: `check_drug_interactions`, 200 medications | 9.83 µs | 14.70 µs | 28.57 µs |
| invalid input (error path, builds messages) | 14.31 µs | 28.82 µs | 45.89 µs |

### Cumulative: one agent run (1 task + 30 tool calls)

| Scenario | p50 | p95 | p99 |
|---|---:|---:|---:|
| typical run | 18 µs | 32 µs | 129 µs |
| worst case (5,000-char task, 30 × ~96 KB bills) | 35 µs | 53 µs | 104 µs |

## Findings

- **Validation overhead is negligible.** A whole 30-call agent run spends
  well under 0.2 ms at p99 validating, against tool calls that each make
  network/x402 requests and an LLM round-trip measured in hundreds of
  milliseconds to seconds.
- **Payload size barely matters for tool validation.** Large string fields are
  only length-checked (`audit_medical_bill` validates a ~96 KB string in
  <2 µs); cost grows with the number of elements zod must walk (200
  medications ≈ 10 µs). The expensive step for large bills is the runner's
  own `JSON.parse`, not validation.
- **`validateTask` threw an exception for every normal task.** Its JSON `role`
  probe called `JSON.parse` on plain text and caught the resulting error,
  which was ~85% of the function's cost.
- **The blocklist path is the slowest by far (~1 ms)** because it appends a
  audit entry synchronously (`lockSync` on the audit file + `appendFileSync`).
  It only runs for suspicious tasks, once per run.

## Changes made

- `validateTask` only attempts the JSON `role` probe when the task starts
  with `{` (after leading whitespace) — only a JSON object can carry a `role`
  key. Typical-task p50 dropped from ~12.2 µs to ~1.6 µs. A regression test
  covers a `role` object with leading whitespace.
- `TOOL_INPUT_SCHEMAS` / `validateToolInput` moved to the zod-only module
  `agent/tool-input-validation.ts` (re-exported from `agent/tools.ts`, so
  callers and test mocks are unchanged) so they can be benchmarked and tested
  without loading the payment stack.

## Recommendations

- **No schema caching work is needed** — schemas are already cached.
- Keep large structured tool inputs as JSON strings validated by length (as
  `audit_medical_bill` does) rather than deeply nested zod objects; if a
  schema for the parsed line items is ever added, validate after the single
  `JSON.parse` rather than parsing twice.
- If suspicious-task volume ever becomes significant, make the audit append
  on the blocklist path asynchronous; at current (rare) volumes it is not
  worth the complexity.
