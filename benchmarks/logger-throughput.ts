/**
 * Benchmark: Logger throughput impact (#1326)
 *
 * Measures per-call overhead of structured logging (pino) and cumulative
 * impact across a simulated multi-tool agent run.
 *
 * Run: npx tsx benchmarks/logger-throughput.ts
 */

import pino from "pino";

const ITERATIONS = 10_000;
const AGENT_TOOL_CALLS = 30; // max tools per agent run

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgPerCallNs: number;
  callsPerSecond: number;
}

function bench(name: string, iterations: number, fn: () => void): BenchmarkResult {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;
  const avgPerCallNs = (totalMs * 1_000_000) / iterations;
  return {
    name,
    iterations,
    totalMs,
    avgPerCallNs,
    callsPerSecond: (iterations / totalMs) * 1000,
  };
}

function printResult(r: BenchmarkResult) {
  console.log(
    `  ${r.name.padEnd(40)} | ${r.avgPerCallNs.toFixed(0).padStart(6)} ns/call | ${r.callsPerSecond.toFixed(0).padStart(8)} calls/s | ${r.totalMs.toFixed(1)}ms total`,
  );
}

async function main() {
  // Silent pino (no transport, no pretty-printing) — production-like
  const silentLogger = pino({ level: "info" });
  // Suppress output by piping to /dev/null
  silentLogger.level = "silent";

  // Pretty-printed pino (dev mode)
  const devLogger = pino({
    level: "info",
    transport: { target: "pino-pretty", options: { colorize: false } },
  });

  console.log(`\nLogger Throughput Benchmark (#1326)`);
  console.log(`Iterations: ${ITERATIONS.toLocaleString()}\n`);

  console.log(`--- Per-Call Overhead ---\n`);

  const r1 = bench("pino silent (production)", ITERATIONS, () => {
    silentLogger.info({ tool: "compare_pharmacy_prices", latencyMs: 42 }, "tool call");
  });
  printResult(r1);

  const r2 = bench("pino silent + redaction", ITERATIONS, () => {
    silentLogger.info(
      { tool: "pay_for_medication", amount: 25.99, secret: "SABC..." },
      "payment executed",
    );
  });
  printResult(r2);

  const r3 = bench("pino silent + mixin (requestId)", ITERATIONS, () => {
    const child = silentLogger.child({ requestId: "req-abc-123", agentRunId: "run-456" });
    child.info({ tool: "audit_bill" }, "audit complete");
  });
  printResult(r3);

  const r4 = bench("pino pretty (dev mode)", ITERATIONS, () => {
    devLogger.info({ tool: "check_drug_interactions", meds: ["aspirin", "ibuprofen"] }, "interaction check");
  });
  printResult(r4);

  console.log(`\n--- Cumulative Agent Run Simulation ---\n`);

  // Simulate a 15-iteration agent run with 2 tool calls per iteration
  const toolCallsPerIteration = 2;
  const iterations = 15;
  const totalLogs = iterations * toolCallsPerIteration * 3; // tool_call + audit_entry + result

  const simStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (let t = 0; t < toolCallsPerIteration; t++) {
      silentLogger.info({ tool: "compare_pharmacy_prices", iteration: i }, "tool call");
      silentLogger.info({ event: "tool_call", iteration: i }, "audit entry");
      silentLogger.info({ result: { cheapest: 12.99 }, iteration: i }, "tool result");
    }
  }
  const simTotalMs = performance.now() - simStart;

  console.log(`  Simulated run: ${iterations} iterations x ${toolCallsPerIteration} tools x 3 logs = ${totalLogs} log calls`);
  console.log(`  Total logging time: ${simTotalMs.toFixed(1)}ms`);
  console.log(`  Per-log overhead: ${((simTotalMs * 1_000_000) / totalLogs).toFixed(0)}ns`);
  console.log(`  Logging as % of typical 5s agent run: ${((simTotalMs / 5000) * 100).toFixed(2)}%\n`);

  console.log(`Done.`);
}

main().catch(console.error);
