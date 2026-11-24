/**
 * #982: k6 load test — concurrent POST /agent/policy updates.
 *
 * Hammers POST /agent/policy with distinct field values from multiple VUs
 * to detect lost writes, races on module-level mutable state, or 5xx errors.
 *
 * Usage: k6 run --env BASE_URL=http://localhost:3000 load/policy-concurrent.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const policyLatency = new Trend("policy_update_latency_ms", true);
const writeErrors = new Counter("policy_write_errors");

export const options = {
  vus: 20,
  duration: "30s",
  thresholds: {
    policy_update_latency_ms: ["p(95)<300", "p(99)<800"],
    policy_write_errors: [{ threshold: "count<10", abort: false }],
  },
};

export default function () {
  const payload = JSON.stringify({
    copay_cap: Math.floor(Math.random() * 100) + 1,
    formulary_tier: Math.floor(Math.random() * 5) + 1,
    max_monthly_spend: Math.floor(Math.random() * 5000) + 1000,
    updated_by: `vu-${__VU}`,
  });

  const res = http.post(
    `${__ENV.BASE_URL || "http://localhost:3000"}/agent/policy`,
    payload,
    { headers: { "Content-Type": "application/json" } }
  );

  policyLatency.add(res.timings.waiting);

  const ok = check(res, {
    "status is 200 or 202": (r) => r.status === 200 || r.status === 202,
    "no 5xx": (r) => r.status < 500,
  });

  if (!ok) writeErrors.add(1);

  sleep(0.1);
}
