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

## Running the SSE stream soak test

`load/agent-stream.js` verifies that `/agent/stream` can hold many long-lived
SSE connections while agent status broadcasts are delivered to every connected
client. It uses the community SSE extension import `k6/x/sse`.

```bash
# From the careguard/ root, with the agent server running
BASE_URL=http://localhost:3004 AGENT_API_KEY=dev-secret pnpm load:stream

# Or directly
BASE_URL=http://localhost:3004 AGENT_API_KEY=dev-secret k6 run load/agent-stream.js
```

Configurable environment variables:

| Variable | Default | Description |
|---|---:|---|
| `STREAM_CONNECTIONS` | `50` | Number of concurrent `/agent/stream` clients. |
| `STREAM_HOLD_SECONDS` | `30` | Minimum time each client should keep the SSE connection open. |
| `STREAM_BROADCASTS` | `4` | Number of pause/resume broadcast requests sent during the soak. |
| `BROADCAST_DELAY_SECONDS` | `5` | Delay before the broadcaster starts, giving clients time to connect. |
| `MIN_EVENTS_PER_CLIENT` | `3 + STREAM_BROADCASTS` | Minimum events each client must see. The initial stream emits spending, status, and transactions. |
| `EXPECTED_STATUS_EVENTS` | `1 + STREAM_BROADCASTS` | Initial status event plus broadcast status events expected per client. |
| `METRICS_TOKEN` | unset | Bearer token for `/metrics` when metrics are protected. |
| `MAX_RSS_DELTA_BYTES` | `67108864` | Maximum allowed RSS growth after all clients disconnect. |

The SSE soak fails when:

- any SSE connection errors,
- fewer than 95% of clients receive the expected initial and broadcast events,
- fewer than 95% of clients disconnect cleanly,
- a pause/resume broadcast fails or exceeds the latency threshold,
- `agent_sse_clients` does not return to its starting value,
- process RSS grows beyond `MAX_RSS_DELTA_BYTES` after disconnect.

The agent exposes the `agent_sse_clients` Prometheus gauge so the test can
confirm long-lived connections are removed from the server registry after the
soak. SSE payloads are also serialized defensively, so an unexpected circular
payload is reported as an SSE error object instead of crashing the broadcaster.

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
