/** Reproducible scaling investigations for issues #1295–#1298. */
import { performance } from "node:perf_hooks";
import { auditBill, type LineItem } from "../shared/bill-audit.ts";
import {
  summarizeAdherenceRecords,
  type AdherenceRecord,
} from "../shared/adherence.ts";
import {
  buildInteractionIndex,
  checkInteractions,
  type Interaction,
} from "../services/drug-interaction-api/logic.ts";
import { WalletBalanceCache } from "../shared/wallet-balance.ts";

const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 500);

function percentile(sorted: readonly number[], value: number): number {
  const index = Math.max(0, Math.ceil((value / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)] ?? 0;
}

function measure(operation: () => void, samples = iterations) {
  for (let i = 0; i < 20; i++) operation();
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    operation();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return { p50Ms: percentile(timings, 50), p95Ms: percentile(timings, 95), p99Ms: percentile(timings, 99) };
}

async function measureAsync(operation: () => Promise<unknown>, samples: number) {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    await operation();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return { p50Ms: percentile(timings, 50), p95Ms: percentile(timings, 95), p99Ms: percentile(timings, 99) };
}

function billItems(count: number): LineItem[] {
  const codes = ["99213", "99214", "70553", "71046", "80053", "85025"];
  return Array.from({ length: count }, (_, index) => ({
    description: `Line item ${index}`,
    cptCode: codes[index % codes.length],
    quantity: 1,
    chargedAmount: 150 + (index % 20),
  }));
}

function adherenceRecords(days: number): AdherenceRecord[] {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const statuses: AdherenceRecord["status"][] = ["confirmed", "pending", "skipped", "flagged"];
  return Array.from({ length: days }, (_, index) => ({
    id: `adh-${index}`,
    recipientId: index % 10 === 0 ? "other" : "rosa",
    drug: "lisinopril",
    pharmacy: "benchmark",
    orderId: `order-${index}`,
    daysSupply: 1,
    orderedAt: new Date(start + index * 86_400_000).toISOString(),
    dueDate: new Date(start + (index + 1) * 86_400_000).toISOString(),
    status: statuses[index % statuses.length],
    skippedCount: index % 4,
  }));
}

function interactionDataset(count: number): Interaction[] {
  return Array.from({ length: count }, (_, index) => ({
    drugs: [`drug-${index}`, `drug-${index + 1}`],
    severity: index % 3 === 0 ? "severe" : index % 3 === 1 ? "moderate" : "mild",
    description: `Synthetic interaction ${index}`,
    recommendation: "Benchmark only",
  }));
}

function scanInteractions(medications: string[], interactions: readonly Interaction[]): number {
  let matches = 0;
  for (let left = 0; left < medications.length; left++) {
    for (let right = left + 1; right < medications.length; right++) {
      for (const interaction of interactions) {
        if (interaction.drugs.includes(medications[left]) && interaction.drugs.includes(medications[right])) matches++;
      }
    }
  }
  return matches;
}

async function benchmarkWallet() {
  const upstreamLatencyMs = Number(process.env.WALLET_BENCH_UPSTREAM_LATENCY_MS ?? 20);
  const cache = new WalletBalanceCache();
  let upstreamCalls = 0;
  const loader = async () => {
    upstreamCalls++;
    await new Promise((resolve) => setTimeout(resolve, upstreamLatencyMs));
    return { address: "GBENCH", usdc: 100, xlm: 25 };
  };
  const cold = await measureAsync(() => {
    cache.clear();
    return cache.get("wallet", loader, 5_000);
  }, 20);
  cache.clear();
  await cache.get("wallet", loader, 5_000);
  const warm = await measureAsync(() => cache.get("wallet", loader, 5_000), iterations);
  const callsBeforeAgentRun = upstreamCalls;
  cache.clear();
  const agentRunStarted = performance.now();
  await Promise.all(Array.from({ length: 6 }, () => cache.get("wallet", loader, 5_000)));
  const agentRun = {
    requestedLookups: 6,
    upstreamCalls: upstreamCalls - callsBeforeAgentRun,
    totalMs: performance.now() - agentRunStarted,
    cache: cache.stats(),
  };
  return { upstreamLatencyMs, cold, warm, agentRun };
}

async function main() {
  const billAudit = [10, 100, 1_000].map((lineItems) => ({ lineItems, ...measure(() => auditBill(billItems(lineItems))) }));
  const adherence = [30, 180, 720].map((recordCount, index) => {
    const records = adherenceRecords(recordCount);
    return {
      months: [1, 6, 24][index],
      records: recordCount,
      ...measure(() => summarizeAdherenceRecords(records, "rosa", new Date("2028-01-01T00:00:00Z"))),
    };
  });
  const drugInteractions = [100, 1_000, 10_000].map((pairs) => {
    const dataset = interactionDataset(pairs);
    const index = buildInteractionIndex(dataset);
    const medications = ["drug-0", "drug-1", "drug-5000", "drug-5001"];
    return {
      pairs,
      indexed: measure(() => checkInteractions(medications, index), Math.min(iterations, 200)),
      scan: measure(() => scanInteractions(medications, dataset), Math.min(iterations, 50)),
    };
  });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), iterations, billAudit, drugInteractions, adherence, wallet: await benchmarkWallet() }, null, 2));
}

await main();
