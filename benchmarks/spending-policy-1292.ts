/** Benchmark #1292 — npm run benchmark:spending-policy */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { TRANSACTION_CATEGORY } from "../shared/types.ts";

const SIZES = [0, 1000, 10000];
const ITER = Number(process.env.BENCHMARK_ITERATIONS ?? 1000);
const dataDir = process.env.DATA_DIR ?? mkdtempSync(join(tmpdir(), "cg-spend-"));
process.env.DATA_DIR = dataDir;
process.env.MOCK_NETWORK = "1";
process.env.SPENDING_TIMEZONE = "UTC";
process.env.AGENT_SECRET_KEY ??= "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";

const tools = await import("../agent/tools.ts");

function pct(sorted: number[], p: number) {
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(i, 0)];
}

function makeTxs(n: number) {
  const t0 = Date.parse("2026-09-25T10:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    id: `tx-${i}`,
    timestamp: new Date(t0 + i * 1000).toISOString(),
    type: "medication",
    description: "bench",
    amount: 1.5,
    category: TRANSACTION_CATEGORY.MEDICATIONS,
    recipient: "bench",
    status: "completed",
  }));
}

tools.setCurrentRecipient("bench");
tools.setSpendingPolicy({
  dailyLimit: 200,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
});

for (const size of SIZES) {
  tools.resetSpendingTracker();
  tools.getSpendingTracker().transactions = makeTxs(size) as any;
  const samples: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    tools.checkSpendingPolicy(12.5, TRANSACTION_CATEGORY.MEDICATIONS);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `tx=${size} p50=${(pct(samples, 50) * 1000).toFixed(1)}us p95=${(pct(samples, 95) * 1000).toFixed(1)}us p99=${(pct(samples, 99) * 1000).toFixed(1)}us`,
  );
}
