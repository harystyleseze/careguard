/**
 * Benchmark: Redis round-trip latency for rate-limit-style counters (#1291)
 *
 * `shared/rate-limit.ts` uses in-process express-rate-limit today; multi-instance
 * deployments would back counters with `shared/redis.ts`. This script load-tests
 * INCR-style checks (one per request) under sustained and burst concurrency.
 *
 * Run: npm run benchmark:redis-rate-limit
 * Env: BENCHMARK_REQUESTS (default 2000), BENCHMARK_BURST (default 100)
 */

import { performance } from "node:perf_hooks";
import RedisMock from "ioredis-mock";
import { createInMemoryClient, createRedisClient } from "../shared/redis.ts";

const REQUESTS = Number(process.env.BENCHMARK_REQUESTS ?? 2_000);
const BURST = Number(process.env.BENCHMARK_BURST ?? 100);

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

async function runSustained(label: string, incr: (key: string) => Promise<number>) {
  const key = `ratelimit:${label}`;
  const samples: number[] = [];
  for (let i = 0; i < REQUESTS; i++) {
    const t0 = performance.now();
    await incr(key);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    p50: percentile(samples, 50) * 1_000,
    p99: percentile(samples, 99) * 1_000,
  };
}

async function runBurst(label: string, incr: (key: string) => Promise<number>) {
  const key = `ratelimit:burst:${label}`;
  const samples: number[] = [];
  for (let batch = 0; batch < REQUESTS / BURST; batch++) {
    const t0 = performance.now();
    await Promise.all(Array.from({ length: BURST }, () => incr(key)));
    samples.push((performance.now() - t0) / BURST);
  }
  samples.sort((a, b) => a - b);
  return {
    label: `${label} (burst ${BURST})`,
    p50: percentile(samples, 50) * 1_000,
    p99: percentile(samples, 99) * 1_000,
  };
}

const memory = createInMemoryClient();
const redis = createRedisClient(new RedisMock() as never);

const fmtUs = (us: number) => `${us.toFixed(1)} µs`.padStart(12);

console.log(`Rate-limit INCR pattern — ${REQUESTS} sustained ops\n`);
console.log(`${"backend".padEnd(28)} | ${"p50".padStart(12)} | ${"p99".padStart(12)}`);
console.log("-".repeat(56));

for (const row of [
  await runSustained("memory", (k) => memory.incr(k)),
  await runSustained("redis-mock", (k) => redis.incr(k)),
  await runBurst("memory", (k) => memory.incr(k)),
  await runBurst("redis-mock", (k) => redis.incr(k)),
]) {
  console.log(`${row.label.padEnd(28)} | ${fmtUs(row.p50)} | ${fmtUs(row.p99)}`);
}
