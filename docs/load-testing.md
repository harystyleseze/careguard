# Load Testing

This document covers the load test for concurrent `/agent/run` requests (Issue #55).

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

## What it checks

| Check | Threshold |
|---|---|
| No 500 responses | `errors_500 == 0` |
| All requests succeed (200) | `success_rate == 1.0` |
| p95 response time | `< 30 s` |

After all runs complete, the script fetches `/agent/spending` and compares:

- **Expected** service fees = `20 runs × $0.002`
- **Actual** service fees from the tracker

A mismatch indicates a lost write or double-count from a race condition.

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
