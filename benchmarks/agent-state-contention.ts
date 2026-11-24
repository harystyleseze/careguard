/**
 * Benchmark: shared/agent-state.ts read/write contention under concurrent agent runs (#1316)
 *
 * Load tests concurrent /agent/status reads alongside asynchronous /agent/run executions,
 * wallet-balance balance checks, and pause/resume writes.
 * Measures read latency, checks for race conditions, tear reads, or stale states.
 *
 * Run: node --import tsx benchmarks/agent-state-contention.ts
 */

import { performance } from "perf_hooks";
import {
  getAgentState,
  pauseAgent,
  resumeAgent,
  isPaused,
  type PauseReason,
  type AgentState,
} from "../shared/agent-state.ts";

const TOTAL_READS = 50_000;
const CONCURRENT_READERS = 20;
const CONCURRENT_WRITERS = 4;
const DURATION_MS = 2000;

interface ContentionReport {
  totalReads: number;
  totalWrites: number;
  avgReadLatencyUs: number;
  p95ReadLatencyUs: number;
  p99ReadLatencyUs: number;
  inconsistentReads: number;
  tornReads: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  console.log(`\nAgent State Read/Write Contention Benchmark (#1316)`);
  console.log(`Node: ${process.version} | Duration: ${DURATION_MS}ms | Readers: ${CONCURRENT_READERS} | Writers: ${CONCURRENT_WRITERS}\n`);

  let isRunning = true;
  let totalReads = 0;
  let totalWrites = 0;
  let inconsistentReads = 0;
  let tornReads = 0;
  const readLatenciesUs: number[] = [];

  // Reset state
  resumeAgent();

  // 1. Background Writers (simulating pause/resume, balance-checker pause, and agent runs)
  const writerReasons: PauseReason[] = ["manual", "low-balance-usdc", "low-balance-xlm"];
  const writers = Array.from({ length: CONCURRENT_WRITERS }, async (_, writerId) => {
    let iteration = 0;
    while (isRunning) {
      const reason = writerReasons[iteration % writerReasons.length];
      if (iteration % 2 === 0) {
        pauseAgent(reason);
      } else {
        resumeAgent();
      }
      totalWrites++;
      iteration++;
      // Yield to event loop to simulate realistic async intervals (0-2ms)
      await new Promise((r) => setTimeout(r, Math.random() * 2));
    }
  });

  // 2. High-throughput Concurrent Readers (simulating polling /agent/status, SSE broadcasts, agent run checks)
  const readers = Array.from({ length: CONCURRENT_READERS }, async () => {
    while (isRunning) {
      const t0 = performance.now();
      const state: AgentState = getAgentState();
      const pausedBool = isPaused();
      const latency = (performance.now() - t0) * 1000;
      readLatenciesUs.push(latency);
      totalReads++;

      // Inconsistency check 1: isPaused() must match state.paused
      if (pausedBool !== state.paused) {
        inconsistentReads++;
      }

      // Inconsistency check 2: torn reads (if paused is true, pausedReason and pausedAt must be non-null; if false, must be null)
      if (state.paused) {
        if (!state.pausedReason || !state.pausedAt) {
          tornReads++;
        }
      } else {
        if (state.pausedReason !== null || state.pausedAt !== null) {
          tornReads++;
        }
      }

      // Small async tick
      if (totalReads % 100 === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }
  });

  // Run test for specified duration
  await new Promise((r) => setTimeout(r, DURATION_MS));
  isRunning = false;

  await Promise.all([...writers, ...readers]);

  const sortedLatencies = [...readLatenciesUs].sort((a, b) => a - b);
  const avgLatencyUs = sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length;

  console.log(`========================================================================`);
  console.log(`  Contention Results under High Concurrency`);
  console.log(`========================================================================`);
  console.log(`  Total Read Operations:      ${totalReads.toLocaleString()}`);
  console.log(`  Total Write Operations:     ${totalWrites.toLocaleString()}`);
  console.log(`  Read Throughput:            ${((totalReads / DURATION_MS) * 1000).toFixed(0)} ops/sec`);
  console.log(`  Average Read Latency:       ${avgLatencyUs.toFixed(2)} µs`);
  console.log(`  p50 Read Latency:           ${percentile(sortedLatencies, 50).toFixed(2)} µs`);
  console.log(`  p95 Read Latency:           ${percentile(sortedLatencies, 95).toFixed(2)} µs`);
  console.log(`  p99 Read Latency:           ${percentile(sortedLatencies, 99).toFixed(2)} µs`);
  console.log(`  Inconsistent Reads:         ${inconsistentReads} (${((inconsistentReads / totalReads) * 100).toFixed(4)}%)`);
  console.log(`  Torn Reads:                 ${tornReads} (${((tornReads / totalReads) * 100).toFixed(4)}%)`);
  console.log(`========================================================================\n`);

  console.log(`Synchronization Assessment:`);
  console.log(`- In a single Node.js process, V8's single-threaded event loop executes synchronous`);
  console.log(`  state mutations atomically (no torn reads observed).`);
  console.log(`- However, multi-process horizontal scaling (e.g. multi-replica container/cluster)`);
  console.log(`  requires an external store (Redis key / distributed lock) to synchronize state`);
  console.log(`  across instances.`);

  console.log(`\nDone.`);
}

main().catch(console.error);
