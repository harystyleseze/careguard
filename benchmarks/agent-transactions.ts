/**
 * Benchmark: GET /agent/transactions as history grows (#1302)
 *
 * Measures the handler's work — paginating the stored history and
 * JSON-serialising the response — at 100 / 1,000 / 10,000 stored
 * transactions, reporting p50/p95/p99 latency and response payload size for:
 *   - the default page (limit=25),
 *   - the maximum page (limit=MAX_TRANSACTIONS_LIMIT),
 *   - an unbounded request (limit=total), i.e. the pre-#1302 behaviour where
 *     `?limit=<huge>` returned the whole history in one response.
 *
 * Run: npx tsx benchmarks/agent-transactions.ts
 * Env: BENCHMARK_ITERATIONS (default 500) samples per scenario.
 */

import type { Transaction } from "../shared/types.ts";
import {
  MAX_TRANSACTIONS_LIMIT,
  paginateTransactions,
} from "../shared/transaction-pagination.ts";

const SIZES = [100, 1_000, 10_000];
const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS ?? 500);

function makeTransactions(count: number): Transaction[] {
  const types = ["medication", "bill", "service_fee"] as const;
  const start = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, i) => ({
    id: `tx-${i.toString().padStart(6, "0")}`,
    timestamp: new Date(start + i * 3_600_000).toISOString(),
    type: types[i % types.length],
    description: `Payment ${i} for Rosa's care plan`,
    amount: +((i % 97) + 0.99).toFixed(2),
    recipient: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    stellarTxHash: (i.toString(16).padStart(8, "0")).repeat(8),
    txHashStatus: "extracted",
    status: "completed",
  })) as Transaction[];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

/** One request's worth of handler work: paginate + serialise the body. */
function handle(tracker: { transactions: Transaction[] }, limit: number): string {
  const { transactions, pagination } = paginateTransactions(tracker.transactions, limit, 0);
  return JSON.stringify({ ...tracker, transactions, pagination });
}

function measure(tracker: { transactions: Transaction[] }, limit: number) {
  const samples: number[] = [];
  let bytes = 0;
  // Warm up the JIT so the first samples don't dominate p99.
  for (let i = 0; i < 20; i++) handle(tracker, limit);
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    const body = handle(tracker, limit);
    samples.push(performance.now() - t0);
    bytes = Buffer.byteLength(body);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    bytes,
  };
}

/**
 * The pre-#1302 handler honoured any limit; reproduce that by paginating a
 * copy with no cap, so the "unbounded" column shows what the cap prevents.
 */
function measureUnbounded(tracker: { transactions: Transaction[] }) {
  const samples: number[] = [];
  let bytes = 0;
  const run = () => {
    const all = tracker.transactions.slice().reverse();
    return JSON.stringify({ ...tracker, transactions: all });
  };
  for (let i = 0; i < 20; i++) run();
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    const body = run();
    samples.push(performance.now() - t0);
    bytes = Buffer.byteLength(body);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    bytes,
  };
}

const fmtMs = (ms: number) => `${ms.toFixed(3)}ms`.padStart(10);
const fmtKb = (b: number) => `${(b / 1024).toFixed(1)} KB`.padStart(11);

function main() {
  console.log(`GET /agent/transactions — ${ITERATIONS} samples per scenario\n`);
  console.log(
    `${"stored".padStart(7)} | ${"scenario".padEnd(20)} | ${"p50".padStart(10)} | ${"p95".padStart(10)} | ${"p99".padStart(10)} | ${"payload".padStart(11)}`,
  );
  console.log("-".repeat(84));
  for (const size of SIZES) {
    const tracker = {
      medications: 0,
      bills: 0,
      serviceFees: 0,
      transactions: makeTransactions(size),
    };
    const rows: [string, ReturnType<typeof measure>][] = [
      ["limit=25 (default)", measure(tracker, 25)],
      [`limit=${MAX_TRANSACTIONS_LIMIT} (max)`, measure(tracker, MAX_TRANSACTIONS_LIMIT)],
      ["unbounded (pre-fix)", measureUnbounded(tracker)],
    ];
    for (const [name, r] of rows) {
      console.log(
        `${String(size).padStart(7)} | ${name.padEnd(20)} | ${fmtMs(r.p50)} | ${fmtMs(r.p95)} | ${fmtMs(r.p99)} | ${fmtKb(r.bytes)}`,
      );
    }
  }
}

main();
