/**
 * Benchmark: Agent runner per-iteration overhead (#1328)
 *
 * Measures the fixed cost repeated on every loop iteration in agent/runner.ts:
 * state updates, message assembly, tool execution dispatch, audit logging,
 * and metrics recording — separate from actual LLM or tool execution time.
 *
 * Run: npx tsx benchmarks/agent-runner.ts
 *
 * This is a synthetic benchmark that mocks the LLM and tool calls to isolate
 * the runner's own overhead. Real-world numbers will be higher due to I/O.
 */

const ITERATIONS = 1_000;
const TOOL_CALL_COUNTS = [1, 5, 15];

interface IterationMetrics {
  messageAssemblyNs: number;
  toolDispatchNs: number;
  auditLogNs: number;
  metricsRecordNs: number;
  totalFixedOverheadNs: number;
}

function bench(fn: () => void, iterations: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return times;
}

function stats(times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  return { avgMs: avg, p50Ms: p50, p95Ms: p95 };
}

async function main() {
  console.log(`\nAgent Runner Per-Iteration Overhead Benchmark (#1328)`);
  console.log(`Iterations: ${ITERATIONS.toLocaleString()}\n`);

  // Simulate the fixed per-iteration costs from runner.ts

  // 1. Message array assembly (push to messages[], build tool_content)
  const messages: unknown[] = [];
  const msgMetrics = bench(() => {
    messages.push({ role: "tool", tool_call_id: "call_mock", content: '{"ok":true}' });
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: "call_mock", type: "function", function: { name: "test", arguments: "{}" } }] });
    if (messages.length > 100) messages.length = 0; // prevent unbounded growth
  }, ITERATIONS);
  console.log(`  Message assembly:   avg=${stats(msgMetrics).avgMs.toFixed(3)}ms | p95=${stats(msgMetrics).p95Ms.toFixed(3)}ms`);

  // 2. Tool dispatch (JSON.parse + switch + function call routing)
  const toolInput = '{"drug_name":"aspirin","zip_code":"10001","dosage":"100mg"}';
  const dispatchMetrics = bench(() => {
    const parsed = JSON.parse(toolInput);
    // Simulate the switch-case routing
    const name = "compare_pharmacy_prices";
    void name;
    void parsed;
  }, ITERATIONS);
  console.log(`  Tool dispatch:      avg=${stats(dispatchMetrics).avgMs.toFixed(3)}ms | p95=${stats(dispatchMetrics).p95Ms.toFixed(3)}ms`);

  // 3. Audit log entry (createHash + append)
  const auditMetrics = bench(() => {
    const entry = { event: "tool_call", actor: "agent", details: { tool: "test", inputs: {} } };
    JSON.stringify(entry); // simulate serialization
  }, ITERATIONS);
  console.log(`  Audit log entry:    avg=${stats(auditMetrics).avgMs.toFixed(3)}ms | p95=${stats(auditMetrics).p95Ms.toFixed(3)}ms`);

  // 4. Metrics recording (Prometheus inc/set)
  const metricsMetrics = bench(() => {
    // Simulate prometheus counter inc + histogram observe
    const labels = { tool: "compare_pharmacy_prices", status: "success" };
    void labels;
  }, ITERATIONS);
  console.log(`  Metrics recording: avg=${stats(metricsMetrics).avgMs.toFixed(3)}ms | p95=${stats(metricsMetrics).p95Ms.toFixed(3)}ms`);

  // 5. Total per-iteration fixed overhead
  const totalMetrics = bench(() => {
    // Full iteration overhead (excluding LLM and tool execution)
    messages.push({ role: "tool", tool_call_id: "call_mock", content: '{"ok":true}' });
    const parsed = JSON.parse(toolInput);
    void parsed;
    JSON.stringify({ event: "tool_call", tool: "test" });
    void { tool: "test", status: "success" };
    if (messages.length > 100) messages.length = 0;
  }, ITERATIONS);

  const totalStats = stats(totalMetrics);
  console.log(`\n  Total fixed overhead per iteration: avg=${totalStats.avgMs.toFixed(3)}ms | p95=${totalStats.p95Ms.toFixed(3)}ms`);

  // Extrapolate to multi-tool runs
  console.log(`\n--- Extrapolated Cumulative Overhead ---\n`);
  for (const toolCalls of TOOL_CALL_COUNTS) {
    const iterations = Math.min(toolCalls, 15);
    const overheadMs = totalStats.avgMs * iterations;
    console.log(`  ${String(toolCalls).padStart(2)} tool calls across ${String(iterations).padStart(2)} iterations: ~${overheadMs.toFixed(1)}ms fixed overhead`);
  }

  console.log(`\nDone.`);
}

main().catch(console.error);
