/**
 * #981: k6 load test — audit-log JSONL append under sustained concurrent writes.
 *
 * Drives 20 VUs concurrently appending to data/audit.log.jsonl, then
 * scripts/verify-audit-log.ts is run post-load to assert zero hash-chain breaks.
 *
 * Usage:
 *   k6 run --env BASE_URL=http://localhost:3000 load/audit-log-concurrent.js
 *
 * After the run:
 *   tsx scripts/verify-audit-log.ts
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const appendLatency = new Trend("audit_append_latency_ms", true);
const errors = new Counter("audit_append_errors");

export const options = {
  vus: 20,
  duration: "30s",
  thresholds: {
    audit_append_latency_ms: ["p(95)<200", "p(99)<500"],
    audit_append_errors: [{ threshold: "count<10", abort: false }],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const payload = JSON.stringify({
    action: "test_concurrent_append",
    actor: `vu-${__VU}`,
    detail: `iteration-${__ITER}`,
    timestamp: Date.now(),
  });

  const res = http.post(`${__ENV.BASE_URL || "http://localhost:3000"}/agent/run`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  appendLatency.add(res.timings.waiting);

  const ok = check(res, {
    "status is 200 or 202": (r) => r.status === 200 || r.status === 202,
  });

  if (!ok) {
    errors.add(1);
  }

  sleep(0.05);
}
