/**
 * Benchmark: shared/stellar-fee.ts fee calculation latency under concurrent payment submissions (#1317)
 *
 * Compares single-call vs 10 concurrent calls latency.
 * Demonstrates per-call network fetch vs TTL cache + in-flight deduplication.
 * Quantifies rate limit impact and critical path latency for payments.
 *
 * Run: node --import tsx benchmarks/stellar-fee-concurrency.ts
 */

import { performance } from "perf_hooks";
import { Horizon } from "@stellar/stellar-sdk";
import { getTargetFee } from "../shared/stellar-fee.ts";

const ITERATIONS = 100;
const CONCURRENCY_LEVELS = [1, 5, 10, 25];

interface BenchmarkResult {
  name: string;
  concurrency: number;
  totalCalls: number;
  totalMs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  networkRequestsSent: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function createMockHorizon(simulatedNetworkLatencyMs = 80) {
  let networkCalls = 0;
  const mock = {
    feeStats: async () => {
      networkCalls++;
      // Simulate network round-trip time to Stellar Horizon
      await new Promise((r) => setTimeout(r, simulatedNetworkLatencyMs));
      return {
        fee_charged: {
          max: "2000",
          min: "100",
          mode: "100",
          p10: "100",
          p20: "100",
          p30: "100",
          p40: "100",
          p50: "100",
          p60: "100",
          p70: "100",
          p80: "100",
          p90: "450",
          p95: "1000",
          p99: "1500",
        },
        max_fee: {
          p90: "500",
        },
        ledger_capacity_usage: "0.50",
      };
    },
    getNetworkCalls: () => networkCalls,
    resetNetworkCalls: () => {
      networkCalls = 0;
    },
  };
  return mock as unknown as Horizon.Server & { getNetworkCalls: () => number; resetNetworkCalls: () => void };
}

// Cached version implementation for benchmark comparison
function createCachedTargetFee(ttlMs = 5000) {
  let cachedFee: string | null = null;
  let cachedAt = 0;
  let inFlightPromise: Promise<string> | null = null;

  return async function getTargetFeeCached(horizon: Horizon.Server): Promise<string> {
    const now = Date.now();
    if (cachedFee !== null && now - cachedAt < ttlMs) {
      return cachedFee;
    }

    if (inFlightPromise) {
      return inFlightPromise;
    }

    inFlightPromise = (async () => {
      try {
        const fee = await getTargetFee(horizon);
        cachedFee = fee;
        cachedAt = Date.now();
        return fee;
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  };
}

async function runConcurrencyTest(
  name: string,
  concurrency: number,
  feeFetcher: (horizon: Horizon.Server) => Promise<string>,
  horizon: Horizon.Server & { getNetworkCalls: () => number; resetNetworkCalls: () => void },
  totalBatches = 10,
): Promise<BenchmarkResult> {
  horizon.resetNetworkCalls();
  const latenciesMs: number[] = [];

  const start = performance.now();
  for (let b = 0; b < totalBatches; b++) {
    const batchStart = performance.now();
    const promises = Array.from({ length: concurrency }, () => feeFetcher(horizon));
    await Promise.all(promises);
    const batchDuration = performance.now() - batchStart;
    latenciesMs.push(batchDuration);
  }
  const totalMs = performance.now() - start;
  const sorted = [...latenciesMs].sort((a, b) => a - b);

  return {
    name,
    concurrency,
    totalCalls: totalBatches * concurrency,
    totalMs,
    avgLatencyMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50LatencyMs: percentile(sorted, 50),
    p95LatencyMs: percentile(sorted, 95),
    p99LatencyMs: percentile(sorted, 99),
    networkRequestsSent: horizon.getNetworkCalls(),
  };
}

function printHeader(title: string) {
  console.log(`\n========================================================================`);
  console.log(`  ${title}`);
  console.log(`========================================================================`);
}

function printResult(r: BenchmarkResult) {
  console.log(
    `  ${r.name.padEnd(35)} | conc=${String(r.concurrency).padStart(2)} | calls=${String(r.totalCalls).padStart(3)} | netReqs=${String(r.networkRequestsSent).padStart(3)} | avgBatch=${r.avgLatencyMs.toFixed(1).padStart(5)} ms | p95=${r.p95LatencyMs.toFixed(1).padStart(5)} ms`,
  );
}

async function main() {
  console.log(`\nStellar Fee Calculation Concurrency & Latency Benchmark (#1317)`);
  console.log(`Node: ${process.version} | Simulated Network RTT: 80ms\n`);

  const mockHorizon = createMockHorizon(80);

  // 1. Uncached (Current Implementation)
  printHeader("1. Uncached Fee Fetching (Current Implementation)");
  for (const conc of CONCURRENCY_LEVELS) {
    const res = await runConcurrencyTest("Uncached getTargetFee", conc, getTargetFee, mockHorizon, 10);
    printResult(res);
  }

  // 2. Cached with In-Flight Coalescing (Proposed Implementation)
  printHeader("2. Cached getTargetFee with 5s TTL + In-Flight Coalescing");
  const getTargetFeeCached = createCachedTargetFee(5000);
  for (const conc of CONCURRENCY_LEVELS) {
    const res = await runConcurrencyTest("Cached getTargetFee (5s TTL)", conc, getTargetFeeCached, mockHorizon, 10);
    printResult(res);
  }

  // 3. Sustained Load Rate-Limit Impact Analysis
  printHeader("3. Rate Limit & Network Consumption Comparison (100 payments over 10s)");
  const paymentsCount = 100;
  
  // Uncached
  mockHorizon.resetNetworkCalls();
  const t0Uncached = performance.now();
  for (let i = 0; i < paymentsCount; i += 10) {
    await Promise.all(Array.from({ length: 10 }, () => getTargetFee(mockHorizon)));
    await new Promise((r) => setTimeout(r, 100)); // 100ms interval
  }
  const uncachedDuration = performance.now() - t0Uncached;
  const uncachedReqs = mockHorizon.getNetworkCalls();

  // Cached
  mockHorizon.resetNetworkCalls();
  const cachedFeeFn = createCachedTargetFee(5000);
  const t0Cached = performance.now();
  for (let i = 0; i < paymentsCount; i += 10) {
    await Promise.all(Array.from({ length: 10 }, () => cachedFeeFn(mockHorizon)));
    await new Promise((r) => setTimeout(r, 100));
  }
  const cachedDuration = performance.now() - t0Cached;
  const cachedReqs = mockHorizon.getNetworkCalls();

  console.log(`  Uncached: ${paymentsCount} payments -> ${uncachedReqs} Horizon calls (${(uncachedReqs * 360 / 10).toFixed(0)} calls/hr rate) in ${uncachedDuration.toFixed(0)}ms`);
  console.log(`  Cached:   ${paymentsCount} payments -> ${cachedReqs} Horizon calls (${(cachedReqs * 360 / 10).toFixed(0)} calls/hr rate) in ${cachedDuration.toFixed(0)}ms`);
  console.log(`  Network Call Reduction: ${(((uncachedReqs - cachedReqs) / uncachedReqs) * 100).toFixed(1)}% fewer RPC requests`);

  console.log(`\n========================================================================`);
  console.log(`Benchmark Run Complete.`);
}

main().catch(console.error);
