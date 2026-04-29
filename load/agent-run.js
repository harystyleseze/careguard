/**
 * k6 load test — concurrent /agent/run requests (Issue #55)
 *
 * Verifies that 20 parallel requests do not corrupt shared spending state:
 * - No 500 responses
 * - Spending totals match the sum of tool-call amounts exactly
 *
 * Usage:
 *   pnpm load
 *   # or directly:
 *   k6 run load/agent-run.js
 *
 * Requires: k6 installed (https://k6.io/docs/getting-started/installation/)
 * The server must be running with a mocked LLM (set LLM_BASE_URL to a local mock).
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Rate, Trend } from "k6/metrics";

// --- Metrics ---
const errors500 = new Counter("errors_500");
const successRate = new Rate("success_rate");
const runDuration = new Trend("agent_run_duration_ms", true);

// --- Config ---
export const options = {
  scenarios: {
    concurrent_runs: {
      executor: "shared-iterations",
      vus: 20,
      iterations: 20,
      maxDuration: "60s",
    },
  },
  thresholds: {
    // No 500 errors allowed
    errors_500: ["count==0"],
    // All requests must succeed
    success_rate: ["rate==1.0"],
    // Each run should complete within 30s (mocked LLM is fast)
    agent_run_duration_ms: ["p(95)<30000"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3004";

// Task that triggers compare_pharmacy_prices (known tool-call amount: $0.002 per drug)
const TASK = "Compare prices for Lisinopril";

// Track per-VU amounts to verify totals after the run
const amounts = new SharedArray("amounts", function () {
  // Each compare_pharmacy_prices call costs $0.002 in service fees
  return [{ serviceFeePerRun: 0.002 }];
});

export default function () {
  const payload = JSON.stringify({ task: TASK });
  const params = {
    headers: { "Content-Type": "application/json" },
    timeout: "30s",
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/agent/run`, payload, params);
  const elapsed = Date.now() - start;

  runDuration.add(elapsed);

  const ok = check(res, {
    "status is not 500": (r) => r.status !== 500,
    "status is 200": (r) => r.status === 200,
    "response has toolCalls": (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.toolCalls);
      } catch {
        return false;
      }
    },
    "response has spending": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.spending !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (res.status === 500) {
    errors500.add(1);
    console.error(`VU ${__VU} got 500: ${res.body.slice(0, 200)}`);
  }

  successRate.add(ok ? 1 : 0);

  // Small sleep to avoid thundering herd on the mock LLM
  sleep(0.1);
}

export function handleSummary(data) {
  // Fetch final spending state to verify totals
  const spendingRes = http.get(`${BASE_URL}/agent/spending`);
  let spendingNote = "Could not fetch spending summary";

  if (spendingRes.status === 200) {
    try {
      const spending = JSON.parse(spendingRes.body);
      const totalRuns = data.metrics.iterations?.values?.count || 20;
      const expectedServiceFees = +(totalRuns * amounts[0].serviceFeePerRun).toFixed(4);
      const actualServiceFees = spending.spending?.serviceFees ?? "unknown";

      spendingNote = [
        `Expected service fees (${totalRuns} runs × $${amounts[0].serviceFeePerRun}): $${expectedServiceFees}`,
        `Actual service fees in tracker: $${actualServiceFees}`,
        actualServiceFees === expectedServiceFees
          ? "✅ Spending totals match — no lost writes or double-counts"
          : `⚠ Mismatch detected — possible race condition (expected ${expectedServiceFees}, got ${actualServiceFees})`,
      ].join("\n");
    } catch {
      spendingNote = "Failed to parse spending response";
    }
  }

  return {
    stdout: `
=== CareGuard Load Test Summary ===
${spendingNote}

Iterations:   ${data.metrics.iterations?.values?.count ?? "?"}
Success rate: ${((data.metrics.success_rate?.values?.rate ?? 0) * 100).toFixed(1)}%
500 errors:   ${data.metrics.errors_500?.values?.count ?? 0}
p95 duration: ${data.metrics.agent_run_duration_ms?.values?.["p(95)"]?.toFixed(0) ?? "?"}ms
`,
  };
}
