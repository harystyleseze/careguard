#!/usr/bin/env tsx

/**
 * Reproducible measurements for issues #1323 and #1325. The #1327 journal
 * benchmark was removed with agent/journal.ts (#1068), which had no
 * production callers.
 */
import { performance } from "node:perf_hooks";
import { isMockNetwork } from "../shared/network-mode.ts";
import { getPharmacyPrices } from "../shared/pharmacy-pricing.ts";

const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 100_000);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(fn: () => void, count: number): { totalMs: number; perCallUs: number } {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  const totalMs = performance.now() - start;
  return { totalMs, perCallUs: (totalMs * 1_000) / count };
}

function benchmarkNetworkMode() {
  const env = { MOCK_NETWORK: "1", NODE_ENV: "test" } as NodeJS.ProcessEnv;
  const samples = Array.from({ length: 5 }, () => measure(() => isMockNetwork(env), iterations));
  return { iterations, medianTotalMs: median(samples.map((sample) => sample.totalMs)), medianPerCallUs: median(samples.map((sample) => sample.perCallUs)) };
}

function benchmarkPricing() {
  const key = ["lisinopril", "90210"] as const;
  const cold = measure(() => getPharmacyPrices(...key), 1);
  const warm = measure(() => getPharmacyPrices(...key), iterations);
  const popularDrugs = ["lisinopril", "metformin", "atorvastatin", "amlodipine"];
  const mixed = measure(() => {
    const drug = popularDrugs[Math.floor(Math.random() * popularDrugs.length)] ?? popularDrugs[0];
    getPharmacyPrices(drug, Math.random() < 0.8 ? "90210" : `long-tail-${Math.random()}`);
  }, iterations);
  return { cold, warm, mixed, cache: { configured: false, ttlMs: null, hitRate: 0 } };
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), networkMode: benchmarkNetworkMode(), pharmacyPricing: benchmarkPricing() }, null, 2));
