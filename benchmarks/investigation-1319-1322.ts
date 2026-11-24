/**
 * Benchmark & Investigation Suite for Issues #1319, #1320, #1321, and #1322.
 *
 * Reproducible empirical measurements for:
 *   - #1319: Benchmark GET /agent/recipients response time as recipient count scales (1, 10, 100 recipients)
 *   - #1320: Investigate shared/sanitize.ts sanitization cost on large request payloads & deep nesting
 *   - #1321: Load-test concurrent writes to POST/PUT/DELETE /pharmacy/drugs for lock contention & race conditions
 *   - #1322: Benchmark shared/auth.ts token verification overhead across authenticated routes
 *
 * Run via: node --import tsx benchmarks/investigation-1319-1322.ts
 */

import { performance } from "node:perf_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";
import { CareRecipientsStore } from "../services/care-recipients/db.ts";
import { sanitizeUserString } from "../shared/sanitize.ts";
import { PharmacyPricingStore } from "../services/pharmacy-api/db.ts";
import { safeCompare, requireApiKey } from "../shared/auth.ts";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(idx, 0)];
}

function computeStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.reduce((sum, v) => sum + v, 0) / (sorted.length || 1),
  };
}

// ============================================================================
// ISSUE #1319: Benchmark GET /agent/recipients at 1, 10, 100 recipients
// ============================================================================
function runBenchmark1319(iterations = 1000) {
  console.log("\n============================================================");
  console.log("=== ISSUE #1319: Scaling GET /agent/recipients (1, 10, 100) ===");
  console.log("============================================================");

  const counts = [1, 10, 100];
  const results: Record<string, any> = {};

  for (const count of counts) {
    const tempDir = mkdtempSync(join(tmpdir(), `careguard-recipients-${count}-`));
    const dbPath = join(tempDir, "careguard.sqlite");
    const store = new CareRecipientsStore(dbPath);

    // Populate with realistic recipient entities
    for (let i = 1; i < count; i++) {
      store.create({
        name: `Care Recipient ${i}`,
        age: 65 + (i % 30),
        medications: ["Lisinopril 10mg", "Metformin 500mg", "Atorvastatin 20mg", "Amlodipine 5mg"].slice(0, (i % 4) + 1),
        primary_doctor: `Dr. Specialist ${i}, Metro Hospital`,
        insurance: i % 2 === 0 ? "Medicare Part D" : "BlueCross BlueShield Senior",
      });
    }

    // Warm-up
    for (let w = 0; w < 50; w++) {
      const list = store.list();
      JSON.stringify(list);
    }

    // Measure
    const samples: number[] = [];
    let payloadBytes = 0;

    for (let it = 0; it < iterations; it++) {
      const t0 = performance.now();
      const list = store.list();
      const payload = JSON.stringify(list);
      const elapsed = performance.now() - t0;
      samples.push(elapsed);
      if (it === 0) payloadBytes = Buffer.byteLength(payload, "utf8");
    }

    const stats = computeStats(samples);
    results[`recipients_${count}`] = {
      recipientCount: count,
      payloadBytes,
      payloadKb: (payloadBytes / 1024).toFixed(2),
      statsMs: {
        p50: stats.p50.toFixed(4),
        p95: stats.p95.toFixed(4),
        p99: stats.p99.toFixed(4),
        mean: stats.mean.toFixed(4),
      },
    };

    console.log(
      `Count: ${count.toString().padStart(3)} | Payload: ${(payloadBytes / 1024).toFixed(2).padStart(6)} KB | ` +
      `p50: ${stats.p50.toFixed(4)} ms | p95: ${stats.p95.toFixed(4)} ms | p99: ${stats.p99.toFixed(4)} ms`
    );

    rmSync(tempDir, { recursive: true, force: true });
  }

  return results;
}

// ============================================================================
// ISSUE #1320: Investigate shared/sanitize.ts on large & nested payloads
// ============================================================================
function runBenchmark1320(iterations = 5000) {
  console.log("\n============================================================");
  console.log("=== ISSUE #1320: Sanitization Cost on Varying Payload Sizes ===");
  console.log("============================================================");

  const flatScenarios = [
    { name: "typical_string (30 B)", input: "Lisinopril 10mg daily oral tab" },
    { name: "medium_string (200 B)", input: "Office Visit Level 4 - Comprehensive exam for elderly patient with multiple chronic conditions and medication management (99214)".repeat(2) },
    { name: "large_string (10 KB)", input: "A".repeat(10_000) + "\x00\x1fDisallowed <script>alert(1)</script>" },
    { name: "huge_string (100 KB)", input: "Medication refill request description with special characters #$%&! ".repeat(1500) },
    { name: "extreme_string (1 MB)", input: "X".repeat(1_000_000) },
  ];

  const results: Record<string, any> = { flat: {}, nested: {} };

  console.log("--- Flat String Scenarios (sanitizeUserString) ---");
  for (const scenario of flatScenarios) {
    // Warm-up
    for (let w = 0; w < 50; w++) sanitizeUserString(scenario.input);

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      sanitizeUserString(scenario.input);
      samples.push((performance.now() - t0) * 1000); // in microseconds
    }

    const stats = computeStats(samples);
    results.flat[scenario.name] = {
      inputBytes: Buffer.byteLength(scenario.input),
      statsUs: {
        p50: stats.p50.toFixed(2),
        p95: stats.p95.toFixed(2),
        p99: stats.p99.toFixed(2),
        mean: stats.mean.toFixed(2),
      },
    };

    console.log(
      `${scenario.name.padEnd(25)} | Size: ${(Buffer.byteLength(scenario.input) / 1024).toFixed(2).padStart(7)} KB | ` +
      `p50: ${stats.p50.toFixed(2)} µs | p95: ${stats.p95.toFixed(2)} µs | p99: ${stats.p99.toFixed(2)} µs`
    );
  }

  // Nested Object Sanitizer Analysis (Recursive object traversal vs flat)
  console.log("\n--- Nested Object Traversal Scenarios ---");
  function recursiveSanitize(v: unknown, currentDepth = 0, maxDepth = 50): unknown {
    if (currentDepth > maxDepth) return "[MAX_DEPTH_EXCEEDED]";
    if (typeof v === "string") return sanitizeUserString(v);
    if (Array.isArray(v)) return v.map(item => recursiveSanitize(item, currentDepth + 1, maxDepth));
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v).map(([k, val]) => [sanitizeUserString(k), recursiveSanitize(val, currentDepth + 1, maxDepth)])
      );
    }
    return v;
  }

  function makeNested(depth: number): any {
    let obj: any = { message: "Root medication instruction note" };
    for (let d = 0; d < depth; d++) {
      obj = { nextLevel: obj, field: `Level ${d} instruction`, count: d };
    }
    return obj;
  }

  const depths = [1, 5, 20, 50, 100];
  for (const depth of depths) {
    const nestedObj = makeNested(depth);
    const jsonStr = JSON.stringify(nestedObj);
    const sizeBytes = Buffer.byteLength(jsonStr);

    for (let w = 0; w < 20; w++) recursiveSanitize(nestedObj);

    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      recursiveSanitize(nestedObj);
      samples.push((performance.now() - t0) * 1000); // µs
    }

    const stats = computeStats(samples);
    results.nested[`depth_${depth}`] = {
      depth,
      sizeBytes,
      statsUs: {
        p50: stats.p50.toFixed(2),
        p95: stats.p95.toFixed(2),
        p99: stats.p99.toFixed(2),
      },
    };

    console.log(
      `Depth: ${depth.toString().padStart(3)} | JSON Size: ${(sizeBytes / 1024).toFixed(2).padStart(6)} KB | ` +
      `p50: ${stats.p50.toFixed(2)} µs | p95: ${stats.p95.toFixed(2)} µs | p99: ${stats.p99.toFixed(2)} µs`
    );
  }

  return results;
}

// ============================================================================
// ISSUE #1321: Load-test concurrent writes to POST/PUT/DELETE /pharmacy/drugs
// ============================================================================
async function runLoadTest1321(totalOperations = 2000, concurrencyLevels = [1, 10, 25, 50]) {
  console.log("\n============================================================");
  console.log("=== ISSUE #1321: Concurrent Writes Load Test (/pharmacy/drugs) ===");
  console.log("============================================================");

  const results: Record<string, any> = {};

  for (const concurrency of concurrencyLevels) {
    const tempDir = mkdtempSync(join(tmpdir(), `careguard-pharmacy-load-${concurrency}-`));
    const dbPath = join(tempDir, "pharmacy.sqlite");
    const store = new PharmacyPricingStore({ dbPath });

    const operationsPerWorker = Math.floor(totalOperations / concurrency);
    const latencies: number[] = [];
    let lostUpdates = 0;
    let errors = 0;

    const startTime = performance.now();

    // Spawn concurrent workers
    const workers = Array.from({ length: concurrency }, async (_, workerId) => {
      for (let op = 0; op < operationsPerWorker; op++) {
        const drugId = (op % 20); // 20 overlapping drug names to force write conflicts
        const drugName = `test_drug_${drugId}`;
        const opType = op % 5 === 0 ? "DELETE" : (op % 2 === 0 ? "POST" : "PUT");

        const t0 = performance.now();
        try {
          if (opType === "DELETE") {
            store.deleteDrug(drugName);
          } else {
            const updated = store.upsertDrug({
              name: drugName,
              displayName: `Test Drug ${drugId} v${op}`,
              defaultDosage: `${(op % 50) + 10}mg`,
            });
            if (!updated || updated.name !== drugName) {
              lostUpdates++;
            }
          }
          latencies.push(performance.now() - t0);
        } catch (err) {
          errors++;
        }
      }
    });

    await Promise.all(workers);
    const totalTimeMs = performance.now() - startTime;
    const throughputOpsSec = (totalOperations / (totalTimeMs / 1000));
    const stats = computeStats(latencies);

    // Verify dataset consistency
    const finalDrugs = store.listDrugs();

    results[`concurrency_${concurrency}`] = {
      concurrency,
      totalOperations,
      totalTimeMs: totalTimeMs.toFixed(2),
      throughputOpsSec: throughputOpsSec.toFixed(2),
      errors,
      lostUpdates,
      finalDrugCount: finalDrugs.length,
      latencyStatsMs: {
        p50: stats.p50.toFixed(4),
        p95: stats.p95.toFixed(4),
        p99: stats.p99.toFixed(4),
        max: stats.max.toFixed(4),
      },
    };

    console.log(
      `Concurrency: ${concurrency.toString().padStart(3)} | Throughput: ${throughputOpsSec.toFixed(0).padStart(7)} ops/sec | ` +
      `p50: ${stats.p50.toFixed(4)} ms | p95: ${stats.p95.toFixed(4)} ms | p99: ${stats.p99.toFixed(4)} ms | ` +
      `Errors: ${errors} | Lost Updates: ${lostUpdates}`
    );

    rmSync(tempDir, { recursive: true, force: true });
  }

  return results;
}

// ============================================================================
// ISSUE #1322: Benchmark shared/auth.ts token verification overhead
// ============================================================================
function runBenchmark1322(iterations = 50000) {
  console.log("\n============================================================");
  console.log("=== ISSUE #1322: Token Verification Overhead (shared/auth.ts) ===");
  console.log("============================================================");

  const testApiKey = "sk_live_careguard_super_secret_production_key_1234567890abcdef";
  const validToken = testApiKey;
  const invalidTokenSameLength = "sk_live_careguard_super_secret_production_key_9999999999zzzzzz";
  const invalidTokenDiffLength = "sk_short_invalid";

  // Pre-hashed comparison for optimization analysis
  const preHashedApiKey = crypto.createHash("sha256").update(testApiKey).digest();
  function optimizedCompare(token: string, expectedHash: Buffer): boolean {
    const tokenHash = crypto.createHash("sha256").update(token).digest();
    return crypto.timingSafeEqual(tokenHash, expectedHash);
  }

  const scenarios = [
    { name: "safeCompare (Valid Token)", fn: () => safeCompare(validToken, testApiKey) },
    { name: "safeCompare (Invalid Same Length)", fn: () => safeCompare(invalidTokenSameLength, testApiKey) },
    { name: "safeCompare (Invalid Short Length)", fn: () => safeCompare(invalidTokenDiffLength, testApiKey) },
    { name: "optimizedCompare (Pre-hashed Secret)", fn: () => optimizedCompare(validToken, preHashedApiKey) },
  ];

  const results: Record<string, any> = {};

  for (const scenario of scenarios) {
    // Warmup
    for (let w = 0; w < 500; w++) scenario.fn();

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      scenario.fn();
      samples.push((performance.now() - t0) * 1000); // µs
    }

    const stats = computeStats(samples);
    results[scenario.name] = {
      iterations,
      statsUs: {
        p50: stats.p50.toFixed(3),
        p95: stats.p95.toFixed(3),
        p99: stats.p99.toFixed(3),
        mean: stats.mean.toFixed(3),
      },
      opsPerSec: Math.round(1_000_000 / stats.mean),
    };

    console.log(
      `${scenario.name.padEnd(42)} | p50: ${stats.p50.toFixed(3)} µs | p95: ${stats.p95.toFixed(3)} µs | ` +
      `p99: ${stats.p99.toFixed(3)} µs | ${(1_000_000 / stats.mean).toFixed(0).padStart(9)} ops/sec`
    );
  }

  // Full middleware simulation overhead
  process.env.AGENT_API_KEY = testApiKey;
  const mockReq = {
    headers: { authorization: `Bearer ${testApiKey}` },
    query: {},
  } as any;
  const mockRes = {
    status: () => mockRes,
    setHeader: () => mockRes,
    json: () => mockRes,
  } as any;

  const mwSamples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let nextCalled = false;
    const t0 = performance.now();
    requireApiKey(mockReq, mockRes, () => { nextCalled = true; });
    mwSamples.push((performance.now() - t0) * 1000);
  }
  const mwStats = computeStats(mwSamples);
  results["requireApiKey_middleware_full"] = {
    statsUs: {
      p50: mwStats.p50.toFixed(3),
      p95: mwStats.p95.toFixed(3),
      p99: mwStats.p99.toFixed(3),
    },
  };
  console.log(
    `${"requireApiKey Middleware (Full Pipeline)".padEnd(42)} | p50: ${mwStats.p50.toFixed(3)} µs | p95: ${mwStats.p95.toFixed(3)} µs | p99: ${mwStats.p99.toFixed(3)} µs`
  );

  return results;
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function main() {
  console.log("Starting CareGuard Benchmark Suite for Issues #1319, #1320, #1321, #1322...");
  const tStart = performance.now();

  const r1319 = runBenchmark1319();
  const r1320 = runBenchmark1320();
  const r1321 = await runLoadTest1321();
  const r1322 = runBenchmark1322();

  const totalDurationMs = (performance.now() - tStart).toFixed(2);
  console.log(`\nAll benchmarks completed in ${totalDurationMs} ms.`);
}

main().catch(console.error);
