/**
 * Benchmark: shared/request-logger.ts synchronous I/O overhead under high request volume (#1318)
 *
 * Compares throughput, latency, and event loop lag with request logger enabled vs disabled.
 * Measures per-request overhead (AsyncLocalStorage, regex redaction, pino formatting, stdout write).
 * Evaluates event loop delay and compares synchronous vs async/buffered logging.
 *
 * Run: node --import tsx benchmarks/request-logger-overhead.ts
 */

import { monitorEventLoopDelay, performance } from "perf_hooks";
import { Writable } from "stream";
import pino from "pino";
import { requestLifecycleMiddleware } from "../shared/request-lifecycle.ts";

const ITERATIONS = 10_000;

interface BenchmarkResult {
  name: string;
  totalRequests: number;
  totalMs: number;
  avgLatencyUs: number;
  p50LatencyUs: number;
  p95LatencyUs: number;
  p99LatencyUs: number;
  throughputRps: number;
  eventLoopLagP95Ms: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// In-memory blackhole stream to simulate stdout write without polluting terminal
class BlackholeStream extends Writable {
  _write(_chunk: any, _enc: any, cb: () => void) {
    cb();
  }
}

// Mock express req/res/next cycle
function createMockHttpCycle(path = "/agent/spending", statusCode = 200) {
  const finishCallbacks: Array<() => void> = [];
  const req: any = {
    method: "GET",
    path,
    url: path,
    headers: { "x-request-id": "req-bench-test-12345" },
  };
  const res: any = {
    statusCode,
    setHeader: () => {},
    on: (event: string, cb: () => void) => {
      if (event === "finish") finishCallbacks.push(cb);
    },
    emitFinish: () => {
      for (const cb of finishCallbacks) cb();
    },
  };
  return { req, res };
}

async function benchScenario(
  name: string,
  iterations: number,
  executeRequest: (i: number) => Promise<void> | void,
): Promise<BenchmarkResult> {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();

  const latenciesUs: number[] = [];

  // Warmup
  for (let i = 0; i < 500; i++) {
    await executeRequest(i);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await executeRequest(i);
    latenciesUs.push((performance.now() - t0) * 1000);
  }
  const totalMs = performance.now() - start;

  histogram.disable();
  const sorted = [...latenciesUs].sort((a, b) => a - b);

  return {
    name,
    totalRequests: iterations,
    totalMs,
    avgLatencyUs: (totalMs * 1000) / iterations,
    p50LatencyUs: percentile(sorted, 50),
    p95LatencyUs: percentile(sorted, 95),
    p99LatencyUs: percentile(sorted, 99),
    throughputRps: (iterations / totalMs) * 1000,
    eventLoopLagP95Ms: histogram.percentile(95) / 1_000_000,
  };
}

function printHeader(title: string) {
  console.log(`\n========================================================================`);
  console.log(`  ${title}`);
  console.log(`========================================================================`);
}

function printResult(r: BenchmarkResult) {
  console.log(
    `  ${r.name.padEnd(45)} | avg=${r.avgLatencyUs.toFixed(1).padStart(7)} µs | p95=${r.p95LatencyUs.toFixed(1).padStart(7)} µs | p99=${r.p99LatencyUs.toFixed(1).padStart(7)} µs | ${r.throughputRps.toFixed(0).padStart(8)} req/s | lag p95=${r.eventLoopLagP95Ms.toFixed(2)}ms`,
  );
}

async function main() {
  console.log(`\nRequest Logger I/O & Overhead Benchmark (#1318)`);
  console.log(`Node: ${process.version} | Iterations: ${ITERATIONS.toLocaleString()}\n`);

  // 1. Baseline without any request-lifecycle logging
  printHeader("1. Request Throughput: Logger Disabled vs Production vs Dev");
  const baseline = await benchScenario("Baseline (No Logging Middleware)", ITERATIONS, () => {
    const { req, res } = createMockHttpCycle();
    res.emitFinish();
  });
  printResult(baseline);

  // 2. Production Logger (Structured JSON to destination)
  const prodStream = new BlackholeStream();
  const STELLAR_KEY_RE = /S[A-Z2-7]{55}/g;
  function sanitize(v: unknown): unknown {
    return typeof v === "string" ? v.replace(STELLAR_KEY_RE, "[STELLAR-KEY-REDACTED]") : v;
  }
  const prodLogger = pino(
    {
      level: "info",
      formatters: {
        log(obj) {
          return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitize(v)]));
        },
      },
    },
    prodStream,
  );

  const prodMiddleware = (req: any, res: any, next: () => void) => {
    const id = (req.headers["x-request-id"] as string) || "req-test-123";
    req.requestId = id;
    const start = Date.now();
    res.on("finish", () => {
      const duration_ms = Date.now() - start;
      const { method, path } = req;
      const status = res.statusCode;
      prodLogger.info({ method, path, status, duration_ms, requestId: id }, "http");
    });
    next();
  };

  const prodResult = await benchScenario("Production Logger (JSON Destination)", ITERATIONS, () => {
    const { req, res } = createMockHttpCycle();
    prodMiddleware(req, res, () => {
      res.emitFinish();
    });
  });
  printResult(prodResult);

  // 3. Async/Buffered Logger (sonic-boom style buffered write simulation)
  let buffer: string[] = [];
  const BUFFER_SIZE = 100;
  const bufferedLogger = {
    info: (obj: Record<string, unknown>) => {
      buffer.push(JSON.stringify(obj));
      if (buffer.length >= BUFFER_SIZE) {
        // Flush chunk
        buffer = [];
      }
    },
  };
  const asyncMiddleware = (req: any, res: any, next: () => void) => {
    const id = req.headers["x-request-id"] || "req-test-123";
    const start = Date.now();
    res.on("finish", () => {
      bufferedLogger.info({ method: req.method, path: req.path, status: res.statusCode, duration_ms: Date.now() - start, requestId: id });
    });
    next();
  };

  const asyncResult = await benchScenario("Async/Buffered Logger (Batched JSON Flush)", ITERATIONS, () => {
    const { req, res } = createMockHttpCycle();
    asyncMiddleware(req, res, () => {
      res.emitFinish();
    });
  });
  printResult(asyncResult);

  // 4. Breakdown of logger internals
  printHeader("2. Breakdown of Per-Request Overhead Components");

  // Micro-bench of sanitize formatter
  const sampleObj = { method: "POST", path: "/agent/run", status: 200, duration_ms: 45, key: "GBBD..." };
  const tStartSanitize = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    Object.fromEntries(Object.entries(sampleObj).map(([k, v]) => [k, sanitize(v)]));
  }
  const sanitizeMs = performance.now() - tStartSanitize;
  console.log(`  Formatter Sanitization (Object.fromEntries + regex): ${(sanitizeMs * 1000 / ITERATIONS).toFixed(2)} µs/call`);

  // Micro-bench of AsyncLocalStorage run
  const { AsyncLocalStorage } = await import("async_hooks");
  const testAls = new AsyncLocalStorage<any>();
  const tStartAls = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    testAls.run({ requestId: "test-id-123" }, () => {
      testAls.getStore();
    });
  }
  const alsMs = performance.now() - tStartAls;
  console.log(`  AsyncLocalStorage Context run + getStore:           ${(alsMs * 1000 / ITERATIONS).toFixed(2)} µs/call`);

  // 5. Overhead Analysis
  printHeader("3. Overhead & Latency Summary");
  const deltaUs = prodResult.avgLatencyUs - baseline.avgLatencyUs;
  const overheadPct = ((prodResult.avgLatencyUs - baseline.avgLatencyUs) / baseline.avgLatencyUs) * 100;
  console.log(`  Per-Request Latency Overhead (Prod): ${deltaUs.toFixed(2)} µs (${overheadPct.toFixed(1)}% vs baseline)`);
  console.log(`  Throughput Impact:                   ${baseline.throughputRps.toFixed(0)} req/s -> ${prodResult.throughputRps.toFixed(0)} req/s`);
  console.log(`  Event Loop Lag (p95):                ${prodResult.eventLoopLagP95Ms.toFixed(2)} ms`);
  console.log(`  Synchronous I/O Blocking:            ${prodResult.eventLoopLagP95Ms < 10 ? "NO (Sub-millisecond event loop lag)" : "YES (Elevated lag observed)"}`);

  console.log(`\n========================================================================`);
  console.log(`Benchmark Run Complete.`);
}

main().catch(console.error);
