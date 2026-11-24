/**
 * Benchmark: GET /pharmacy/compare aggregation latency vs pharmacy count (#1293)
 *
 * Measures the handler's CPU work — price lookup, buildCompareResponse, JSON
 * serialisation — with synthetic price lists of 10 / 100 / 1000 pharmacies.
 *
 * Run: npm run benchmark:pharmacy-compare
 * Env: BENCHMARK_ITERATIONS (default 500)
 */

import { performance } from "node:perf_hooks";
import type { PharmacyPrice } from "../shared/pharmacy-pricing.ts";
import { getPharmacyPrices } from "../shared/pharmacy-pricing.ts";
import { buildCompareResponse } from "../services/pharmacy-api/logic.ts";

const PHARMACY_COUNTS = [10, 100, 1000];
const ITERATIONS = Number(process.env.BENCHMARK_ITERATIONS ?? 500);
const NETWORK = "stellar:testnet";

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

function syntheticPrices(count: number): PharmacyPrice[] {
  return Array.from({ length: count }, (_, i) => ({
    pharmacy: `Pharmacy ${i}`,
    id: `pharm-${i}`,
    price: 3 + (i % 47) * 0.25,
    distance: `${(i % 20) * 0.3 + 0.5} mi`,
  }));
}

/** One compare request's handler work (mirrors services/pharmacy-api/server.ts). */
function handleCompare(prices: PharmacyPrice[]): string {
  const drug = "lisinopril";
  const dosage = "10mg";
  const zip = "90210";
  const body = buildCompareResponse({
    drug,
    dosage,
    zip,
    usedZipCode: zip,
    isFallbackZip: false,
    payTo: "GTEST",
    network: NETWORK,
    prices,
  });
  return JSON.stringify(body);
}

function measure(prices: PharmacyPrice[]) {
  const samples: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 20; i++) handleCompare(prices);
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    const body = handleCompare(prices);
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

function measureBaselineLookup() {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) getPharmacyPrices("lisinopril", "90210");
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    getPharmacyPrices("lisinopril", "90210");
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    pharmacies: 5,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
  };
}

const fmtMs = (ms: number) => `${ms.toFixed(3)}ms`.padStart(10);
const fmtKb = (b: number) => `${(b / 1024).toFixed(1)} KB`.padStart(11);

console.log(`GET /pharmacy/compare — ${ITERATIONS} samples per row\n`);
console.log(
  `${"pharmacies".padStart(10)} | ${"p50".padStart(10)} | ${"p95".padStart(10)} | ${"p99".padStart(10)} | ${"payload".padStart(11)}`,
);
console.log("-".repeat(58));

const baseline = measureBaselineLookup();
console.log(
  `${String(baseline.pharmacies).padStart(10)} (static DB) | ${fmtMs(baseline.p50)} | ${fmtMs(baseline.p95)} | ${fmtMs(baseline.p99)} | ${"n/a".padStart(11)}`,
);

for (const count of PHARMACY_COUNTS) {
  const r = measure(syntheticPrices(count));
  console.log(
    `${String(count).padStart(10)} | ${fmtMs(r.p50)} | ${fmtMs(r.p95)} | ${fmtMs(r.p99)} | ${fmtKb(r.bytes)}`,
  );
}
