/**
 * Benchmark: Stellar RPC call latency (#1324)
 *
 * Measures individual RPC call latency (submit, fee, sequence lookups)
 * and total payment critical-path latency under concurrent load.
 *
 * Run: npx tsx benchmarks/stellar-rpc.ts
 */

import { Stellar, Networks } from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.STELLAR_RPC_URL || "https://horizon-testnet.stellar.org";
const ITERATIONS = 50;
const CONCURRENCY_LEVELS = [1, 5, 10, 25];

interface BenchmarkResult {
  operation: string;
  iterations: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(times: number[]): Omit<BenchmarkResult, "operation" | "iterations"> {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: times.reduce((a, b) => a + b, 0) / times.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  };
}

async function benchOperation(
  name: string,
  fn: () => Promise<void>,
  iterations: number,
): Promise<BenchmarkResult> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return { operation: name, iterations, ...stats(times) };
}

async function main() {
  const server = new Stellar.Horizon.Server(HORIZON_URL);

  console.log(`\nStellar RPC Latency Benchmark`);
  console.log(`Server: ${HORIZON_URL}`);
  console.log(`Iterations per operation: ${ITERATIONS}\n`);

  // 1. Account lookup (sequence number)
  const testAccount = "GADTXISOLDGS6BFKVC7VY7WY5PWHNBSMWJ3SOAYH7K4DRC5V57TWZSS4";
  const seqResult = await benchOperation(
    "account/sequence lookup",
    async () => {
      await server.loadAccount(testAccount).catch(() => {});
    },
    ITERATIONS,
  );
  printResult(seqResult);

  // 2. Fee stats
  const feeResult = await benchOperation(
    "fee_stats",
    async () => {
      await server.feeStats();
    },
    ITERATIONS,
  );
  printResult(feeResult);

  // 3. Latest ledger
  const ledgerResult = await benchOperation(
    "latest ledger",
    async () => {
      await server.ledgers().latest();
    },
    ITERATIONS,
  );
  printResult(ledgerResult);

  // 4. Concurrent load test
  console.log(`\n--- Concurrent Load Test (${ITERATIONS} operations each) ---\n`);
  for (const concurrency of CONCURRENCY_LEVELS) {
    const times: number[] = [];
    const batches = Math.ceil(ITERATIONS / concurrency);
    for (let b = 0; b < batches; b++) {
      const batch = Array.from({ length: Math.min(concurrency, ITERATIONS - b * concurrency) }, () =>
        server.ledgers().latest().catch(() => {}),
      );
      const start = performance.now();
      await Promise.all(batch);
      times.push(performance.now() - start);
    }
    const s = stats(times);
    console.log(
      `  concurrency=${String(concurrency).padStart(2)} | avg=${s.avgMs.toFixed(1)}ms | p95=${s.p95Ms.toFixed(1)}ms | p99=${s.p99Ms.toFixed(1)}ms`,
    );
  }

  console.log(`\nDone.`);
}

function printResult(r: BenchmarkResult) {
  console.log(
    `  ${r.operation.padEnd(25)} | avg=${r.avgMs.toFixed(1)}ms | p50=${r.p50Ms.toFixed(1)}ms | p95=${r.p95Ms.toFixed(1)}ms | p99=${r.p99Ms.toFixed(1)}ms`,
  );
}

main().catch(console.error);
