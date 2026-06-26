# Load Testing

This document covers the load tests for concurrent `/agent/run` requests (Issue #55)
and dashboard Server-Sent Events (SSE) streams (Issue #274).

## Goal

Verify that 20 parallel `/agent/run` requests do not corrupt the shared in-memory spending state (`spendingTracker`, `lastMppTxHash`, etc.). Unit tests miss races; this test surfaces them.

## Prerequisites

1. [k6](https://k6.io/docs/getting-started/installation/) installed on your machine.
2. A running CareGuard server with a **mocked LLM** so requests complete quickly without real API calls.

### Starting a mock-LLM server

Point `LLM_BASE_URL` at a local OpenAI-compatible stub that returns an empty tool-call response immediately:

```bash
# Example using a simple echo server or a local Ollama instance
LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3 pnpm start
```

Or set `LLM_BASE_URL` to any OpenAI-compatible endpoint that responds quickly.

## Running the load test

```bash
# From the careguard/ root
pnpm load
```

This runs `k6 run load/agent-run.js` with 20 virtual users, each posting one `/agent/run` request concurrently.

To target a different server:

```bash
BASE_URL=https://your-app.onrender.com k6 run load/agent-run.js
```

### Dashboard SSE streams

Issue #274 replaces the dashboard's repeated spending and transaction polling
with a long-lived `GET /agent/stream` connection. Use the stream load smoke test
to verify the agent can hold dashboard-scale concurrency without reopening HTTP
poll requests:

```bash
# From the careguard/ root
BASE_URL=http://localhost:3004 CONNECTIONS=1000 HOLD_MS=30000 npm run load:stream
```

For a quick local smoke test:

```bash
BASE_URL=http://localhost:3004 CONNECTIONS=50 HOLD_MS=3000 npm run load:stream
```

The script opens `CONNECTIONS` SSE connections, waits until every connection
receives the initial `snapshot` event, holds them open for `HOLD_MS`, and exits
non-zero if any stream fails to open or misses its snapshot.

## What it checks

### `/agent/run`

| Check | Threshold |
|---|---|
| No 500 responses | `errors_500 == 0` |
| All requests succeed (200) | `success_rate == 1.0` |
| p95 response time | `< 30 s` |

After all runs complete, the script fetches `/agent/spending` and compares:

- **Expected** service fees = `20 runs × $0.002`
- **Actual** service fees from the tracker

A mismatch indicates a lost write or double-count from a race condition.

### `/agent/stream`

| Check | Threshold |
|---|---|
| Opened SSE connections | equals `CONNECTIONS` |
| Initial `snapshot` events | equals `CONNECTIONS` |
| Stream failures | `0` |

Because `/agent/stream` only broadcasts snapshots when state changes, an idle
dashboard population should settle at open sockets plus periodic heartbeat
events rather than repeated spending/transaction HTTP polling.

## CI

This test is **not** included in the default CI pipeline — it is slow and requires a running server. Run it manually before releases or when changing `agent/tools.ts` state management.

## Interpreting results

```
=== CareGuard Load Test Summary ===
Expected service fees (20 runs × $0.002): $0.04
Actual service fees in tracker: $0.04
✅ Spending totals match — no lost writes or double-counts

Iterations:   20
Success rate: 100.0%
500 errors:   0
p95 duration: 1234ms
```

If you see a mismatch, the module-level `spendingTracker` object has a race. The fix is to move state into a per-request context or use atomic file writes with a lock.
