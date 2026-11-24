/**
 * Benchmark: pricing provider fan-out latency (#1294)
 *
 * Today `createPricingProvider()` selects a single provider. This script
 * measures per-provider `getPrices` latency and compares sequential vs parallel
 * fan-out across all registered providers, including a simulated slow provider.
 *
 * Run: npm run benchmark:pricing-fanout
 * Env: BENCHMARK_ITERATIONS (default 200)
 */

import { performance } from "node:perf_hooks";
import {
  PRICING_PROVIDER_CONFIG,
  type PricingProvider,
} from "../shared/pricing-sources.ts";

const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS ?? 200);
const DRUG = "lisinopril";
const ZIP = "90210";
const SLOW_DELAY_MS = 50;

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

function withSlowProvider(provider: PricingProvider, delayMs: number): PricingProvider {
  return {
    name: `${provider.name}-slow`,
    getDrugCount: () => provider.getDrugCount(),
    async getPrices(drugName, zipCode) {
      await new Promise((r) => setTimeout(r, delayMs));
      return provider.getPrices(drugName, zipCode);
    },
  };
}

async function timeOnce(fn: () => Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function benchAsync(fn: () => Promise<void>, iterations = ITERATIONS) {
  for (let i = 0; i < 10; i++) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(await timeOnce(fn));
  }
  samples.sort((a, b) => a - b);
  return {
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
  };
}

const providers = PRICING_PROVIDER_CONFIG.map((c) => c.create());
const fmtMs = (ms: number) => `${ms.toFixed(3)}ms`.padStart(10);

console.log(`Pricing provider fan-out — ${ITERATIONS} samples\n`);

console.log("Per-provider getPrices():");
for (const provider of providers) {
  const stats = await benchAsync(() => provider.getPrices(DRUG, ZIP).then(() => {}));
  console.log(`  ${provider.name.padEnd(8)} p50 ${fmtMs(stats.p50)}  p95 ${fmtMs(stats.p95)}  p99 ${fmtMs(stats.p99)}`);
}

const sequential = await benchAsync(async () => {
  for (const provider of providers) {
    await provider.getPrices(DRUG, ZIP);
  }
});

const parallel = await benchAsync(async () => {
  await Promise.all(providers.map((p) => p.getPrices(DRUG, ZIP)));
});

console.log("\nFan-out across all providers (same drug):");
console.log(`  sequential  p50 ${fmtMs(sequential.p50)}  p95 ${fmtMs(sequential.p95)}  p99 ${fmtMs(sequential.p99)}`);
console.log(`  parallel    p50 ${fmtMs(parallel.p50)}  p95 ${fmtMs(parallel.p95)}  p99 ${fmtMs(parallel.p99)}`);

const slow = withSlowProvider(providers[0]!, SLOW_DELAY_MS);
const mixed = [slow, ...providers.slice(1)];

const seqSlow = await benchAsync(async () => {
  for (const provider of mixed) {
    await provider.getPrices(DRUG, ZIP);
  }
}, Math.min(ITERATIONS, 50));

const parSlow = await benchAsync(async () => {
  await Promise.all(mixed.map((p) => p.getPrices(DRUG, ZIP)));
}, Math.min(ITERATIONS, 50));

console.log(`\nWith one ${SLOW_DELAY_MS}ms slow provider (${mixed.length} sources):`);
console.log(`  sequential  p50 ${fmtMs(seqSlow.p50)}  p95 ${fmtMs(seqSlow.p95)}  p99 ${fmtMs(seqSlow.p99)}`);
console.log(`  parallel    p50 ${fmtMs(parSlow.p50)}  p95 ${fmtMs(parSlow.p95)}  p99 ${fmtMs(parSlow.p99)}`);
