# Agent queue concurrency (#1289)

**Question:** how does the `/agent/run` queue behave as concurrent requests arrive, and what `AGENT_CONCURRENCY` and `MAX_QUEUE_SIZE` defaults are practical?

**Benchmark:** [`benchmarks/agent-queue-concurrency.ts`](../../benchmarks/agent-queue-concurrency.ts) (`npm run benchmark:agent-queue`).

The benchmark starts the mock LLM and a child HTTP harness that imports the production `shared/agent-queue.ts` and metrics registry. The harness calls the mock LLM once per job, records end-to-end latency, reads queue wait from the `Server-Timing: agent-queue;dur=...` response header, and samples `agent_queue_depth` and `agent_waiting_jobs` from `/metrics`. Using the shared queue directly keeps unrelated payment and Stellar initialization out of the queue measurement.

The default matrix is:

- `AGENT_CONCURRENCIES=1,5,10,20`
- `MAX_QUEUE_SIZES=10,64`
- `ROUNDS=3`
- `MOCK_LLM_DELAY_MS=30`

Each round sends `AGENT_CONCURRENCY + MAX_QUEUE_SIZE` simultaneous requests. That fills the configured queue without intentionally testing the 429 boundary. The harness runs with test-mode rate limiting disabled and a temporary `DATA_DIR`.

## Results

Environment: Node v24.14.1, local Windows development machine, three rounds per cell. The mock LLM delay is 30 ms; values are not a substitute for testing the production LLM provider.

| Server concurrency | Max queue | Requests/s | End-to-end p50 | p95 | p99 | Queue p50 | Queue p95 | Queue p99 | Max waiting | 429 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 10 | 21.7 | 281.6 ms | 515.0 ms | 515.9 ms | 224.8 ms | 458.9 ms | 459.1 ms | 10 | 0 |
| 1 | 64 | 20.6 | 1,613.7 ms | 3,027.8 ms | 3,197.0 ms | 1,506.7 ms | 2,931.6 ms | 3,098.2 ms | 64 | 0 |
| 5 | 10 | 96.9 | 102.0 ms | 153.4 ms | 157.5 ms | 35.5 ms | 85.2 ms | 88.2 ms | 10 | 0 |
| 5 | 64 | 99.7 | 367.9 ms | 645.3 ms | 683.2 ms | 270.9 ms | 548.1 ms | 588.0 ms | 64 | 0 |
| 10 | 10 | 160.5 | 93.2 ms | 135.6 ms | 150.5 ms | 0.0 ms | 54.5 ms | 60.8 ms | 10 | 0 |
| 10 | 64 | 192.2 | 210.4 ms | 369.0 ms | 388.8 ms | 129.4 ms | 263.6 ms | 298.6 ms | 64 | 0 |
| 20 | 10 | 207.4 | 92.4 ms | 150.5 ms | 165.9 ms | 0.0 ms | 50.8 ms | 57.7 ms | 10 | 0 |
| 20 | 64 | 322.5 | 166.6 ms | 261.8 ms | 277.5 ms | 68.2 ms | 141.9 ms | 152.2 ms | 64 | 0 |

## Findings

1. The queue is the limiting resource at concurrency 1. A 64-job burst takes roughly 3.2 seconds at p99, while the same burst at concurrency 5 finishes in about 683 ms at p99.
2. Increasing concurrency improves throughput, but the gain is not linear. The 30 ms mock has substantial queue and HTTP overhead, so production LLM latency and provider limits will dominate.
3. A queue size of 64 absorbs a larger burst without 429 responses in this test, but it also increases the tail at low concurrency. A larger queue is useful for short bursts, not a substitute for capacity planning.
4. The queue gauges return to zero after draining. The `Server-Timing` header gives per-request queue wait, which is more useful than end-to-end latency when debugging a slow agent request.

## Recommendation

Start production deployments with `AGENT_CONCURRENCY=5` and `MAX_QUEUE_SIZE=64`, then increase concurrency only after measuring the LLM provider's rate and token limits. Keep the existing 429 behavior for bursts larger than the configured capacity. Alert on sustained `agent_waiting_jobs`, queue-wait p95, and 429 rate rather than choosing a larger queue solely from a synthetic throughput number.
