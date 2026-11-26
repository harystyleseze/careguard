/**
 * k6 load test — sustained concurrent /agent/run traffic across a live
 * AGENT_SECRET_KEY rotation (Issue #984).
 *
 * Extends the 20-VU concurrency scenario from load/agent-run.js. Partway
 * through the run a single VU triggers the rotation described in
 * docs/runbooks/rotate-agent-key.md (env update + SIGHUP) via the test-only
 * rotation hook (`load/rotation-hook.mjs`). The rest of the VUs keep sending
 * payments, so we can verify the runbook's zero-downtime claim under load.
 *
 * Usage (agent must be started with the rotation hook; see load/README.md):
 *   NEW_AGENT_SECRET_KEY="S<new-stellar-secret>" k6 run load/agent-run-rotation.js
 *
 * Optional env:
 *   BASE_URL, ROTATION_HOOK_URL, ROTATION_START (default "10s"), ITERATIONS
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Counter, Rate, Trend } from "k6/metrics";

// --- Metrics ---
const errors500 = new Counter("errors_500");
const rotationBoundaryErrors = new Counter("rotation_boundary_errors");
const misroutedPayments = new Counter("misrouted_payments");
const duplicatePayments = new Counter("duplicate_payments");
const mixedKeySettlement = new Counter("mixed_key_settlement");
const inFlightAcrossRotation = new Counter("in_flight_across_rotation");
const rotationRequests = new Counter("rotation_requests");
const successRate = new Rate("success_rate");
const runDuration = new Trend("agent_run_duration_ms", true);

// --- Config ---
const BASE_URL = __ENV.BASE_URL || "http://localhost:3004";
const ROTATION_HOOK_URL = __ENV.ROTATION_HOOK_URL || "http://127.0.0.1:3006";
const ROTATION_START = __ENV.ROTATION_START || "10s";
const NEW_AGENT_SECRET_KEY = __ENV.NEW_AGENT_SECRET_KEY;
const ITERATIONS = Number(__ENV.ITERATIONS || 40);
const RUN_ID = __ENV.RUN_ID || `rot-${Date.now()}`;

// Same task/cost as load/agent-run.js so the spending-total check is reusable.
const TASK = "Compare prices for Lisinopril";
const amounts = new SharedArray("rotation-amounts", () => [
  { serviceFeePerRun: 0.002 },
]);

export const options = {
  scenarios: {
    // Unchanged 20-VU concurrency shape from load/agent-run.js.
    concurrent_runs: {
      executor: "shared-iterations",
      exec: "runAgent",
      vus: 20,
      iterations: ITERATIONS,
      maxDuration: "120s",
    },
    // One VU waits until traffic is saturated, then rotates the live key.
    rotate_key: {
      executor: "shared-iterations",
      exec: "rotateKey",
      vus: 1,
      iterations: 1,
      startTime: ROTATION_START,
      maxDuration: "20s",
    },
  },
  thresholds: {
    errors_500: ["count==0"],
    rotation_boundary_errors: ["count==0"],
    misrouted_payments: ["count==0"],
    duplicate_payments: ["count==0"],
    mixed_key_settlement: ["count==0"],
    success_rate: ["rate==1.0"],
    agent_run_duration_ms: ["p(95)<30000"],
  },
};

export function setup() {
  if (!NEW_AGENT_SECRET_KEY) {
    throw new Error(
      "NEW_AGENT_SECRET_KEY is required — generate one with " +
        "Keypair.random().secret() and pass it as an env var",
    );
  }

  const spendingRes = http.get(`${BASE_URL}/agent/spending`);
  const epochRes = http.get(`${ROTATION_HOOK_URL}/epoch`);

  return {
    initialSpending: spendingRes.status === 200 ? safeJson(spendingRes.body) : null,
    initialEpoch: epochRes.status === 200 ? safeJson(epochRes.body) : null,
  };
}

function safeJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Sample the active signer epoch from the in-process rotation hook. */
function currentEpoch() {
  const res = http.get(`${ROTATION_HOOK_URL}/epoch`);
  return res.status === 200 ? safeJson(res.body) : null;
}

export function runAgent() {
  // Unique marker lets us detect misrouted or duplicated logical payments.
  const marker = `[rotation-${RUN_ID}-${__VU}-${__ITER}]`;
  const epochBefore = currentEpoch();

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/agent/run`,
    JSON.stringify({ task: `${TASK} ${marker}` }),
    {
      headers: { "Content-Type": "application/json" },
      timeout: "30s",
    },
  );
  const elapsed = Date.now() - start;
  const epochAfter = currentEpoch();

  runDuration.add(elapsed);

  const body = safeJson(res.body);
  const ok = check(res, {
    "status is not 500": (r) => r.status !== 500,
    "status is 200": (r) => r.status === 200,
    "response has toolCalls": () => Array.isArray(body?.toolCalls),
    "response has spending": () => body?.spending !== undefined,
  });

  if (res.status === 500) {
    errors500.add(1);
    console.error(`VU ${__VU} got 500 across rotation: ${String(res.body).slice(0, 200)}`);
  }
  successRate.add(ok ? 1 : 0);

  // Detect misrouting/duplication of a logical payment in the response.
  const markers = String(res.body || "").match(/\[rotation-[^\]]+\]/g) || [];
  if (markers.some((m) => m !== marker)) misroutedPayments.add(1);
  if (markers.filter((m) => m === marker).length > 1) duplicatePayments.add(1);

  // Classify which key generation settled this request.
  if (epochBefore && epochAfter && epochBefore.epoch !== epochAfter.epoch) {
    inFlightAcrossRotation.add(1);
    // A request that started before SIGHUP and finished after it must still
    // succeed (runbook: in-flight requests complete normally).
    if (res.status >= 500) rotationBoundaryErrors.add(1);

    // One logical payment settling under two different keys would be a
    // mixed-key settlement. The hook records the epoch per key generation;
    // a response carrying more than one payment call across the boundary is
    // conservatively flagged rather than silently ignored.
    const paymentCalls = (body?.toolCalls || []).filter((tc) =>
      /pay|purchase|order/i.test(String(tc?.name || "")),
    );
    if (paymentCalls.length > 1) mixedKeySettlement.add(1);
  }

  sleep(0.1);
}

export function rotateKey() {
  const res = http.post(
    `${ROTATION_HOOK_URL}/rotate`,
    JSON.stringify({ secretKey: NEW_AGENT_SECRET_KEY }),
    { headers: { "Content-Type": "application/json" }, timeout: "5s" },
  );

  rotationRequests.add(1);
  const ok = check(res, {
    "rotation hook accepted new key": (r) => r.status === 200,
    "rotation epoch advanced": (r) => {
      const state = safeJson(r.body);
      return state?.epoch === 1;
    },
  });

  if (!ok) rotationBoundaryErrors.add(1);
}

export function teardown(data) {
  const finalEpoch = currentEpoch();
  console.log(
    `[rotation] epoch ${data.setupData?.initialEpoch?.epoch ?? "?"} -> ${finalEpoch?.epoch ?? "?"}; ` +
      `in-flight across boundary: ${data.metrics?.in_flight_across_rotation?.values?.count ?? 0}`,
  );
}

export function handleSummary(data) {
  const setupData = data.setupData || {};
  const initial = setupData.initialSpending;
  const spendingRes = http.get(`${BASE_URL}/agent/spending`);
  let spendingNote = "Could not fetch final spending summary";

  if (spendingRes.status === 200) {
    const spending = safeJson(spendingRes.body);
    const totalRuns = data.metrics.iterations?.values?.count || ITERATIONS;

    if (spending && initial) {
      const expectedServiceFees = +(totalRuns * amounts[0].serviceFeePerRun).toFixed(4);
      const serviceFeesBefore = initial.spending?.serviceFees ?? 0;
      const serviceFeesAfter = spending.spending?.serviceFees ?? 0;
      const actualServiceFees = +(serviceFeesAfter - serviceFeesBefore).toFixed(4);
      const txDelta =
        (spending.transactionCount ?? 0) - (initial.transactionCount ?? 0);

      spendingNote = [
        `Expected service fees (${totalRuns} runs x $${amounts[0].serviceFeePerRun}): $${expectedServiceFees}`,
        `Actual service fees across rotation: $${actualServiceFees}`,
        `Transaction count delta: ${txDelta} (expected <= ${totalRuns})`,
        actualServiceFees === expectedServiceFees
          ? "OK Spending totals match — no lost writes or double-counts"
          : `WARN Mismatch detected — possible race condition (expected ${expectedServiceFees}, got ${actualServiceFees})`,
        txDelta > totalRuns
          ? "WARN Duplicate payments detected across rotation"
          : "OK No duplicate payments beyond expected runs",
      ].join("\n");
    }
  }

  const errors = data.metrics.errors_500?.values?.count ?? 0;
  const boundaryErrors = data.metrics.rotation_boundary_errors?.values?.count ?? 0;
  const duplicates = data.metrics.duplicate_payments?.values?.count ?? 0;
  const misrouted = data.metrics.misrouted_payments?.values?.count ?? 0;
  const mixed = data.metrics.mixed_key_settlement?.values?.count ?? 0;
  const claimVerdict =
    errors === 0 && boundaryErrors === 0 && duplicates === 0 && misrouted === 0 && mixed === 0
      ? "CONFIRMED zero-downtime under sustained load (docs/runbooks/rotate-agent-key.md)"
      : "REFUTED zero-downtime claim under sustained load — investigate rotation boundary";

  return {
    stdout: `
=== CareGuard Agent-Run Key-Rotation Load Test (Issue #984) ===
${spendingNote}

Rotation requests:         ${data.metrics.rotation_requests?.values?.count ?? 0}
In-flight across boundary: ${data.metrics.in_flight_across_rotation?.values?.count ?? 0}
500 errors:                ${errors}
Rotation boundary errors:  ${boundaryErrors}
Misrouted payments:        ${misrouted}
Duplicate payments:        ${duplicates}
Mixed-key settlements:     ${mixed}
Success rate:              ${((data.metrics.success_rate?.values?.rate ?? 0) * 100).toFixed(1)}%
p95 duration:              ${data.metrics.agent_run_duration_ms?.values?.["p(95)"]?.toFixed(0) ?? "?"}ms

Runbook claim: ${claimVerdict}
`,
  };
}
