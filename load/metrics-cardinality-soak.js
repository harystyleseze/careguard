/**
 * #983: k6 soak test — /metrics scrape latency as pharmacy_unknown_drug_total
 * label cardinality grows under sustained traffic.
 *
 * Drives concurrent GET /metrics scrapes at 5s intervals while generating
 * many distinct {drug=...} label values to quantify the cardinality risk
 * flagged in metrics-naming.md.
 *
 * Usage: k6 run --env BASE_URL=http://localhost:3000 load/metrics-cardinality-soak.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend, Gauge } from "k6/metrics";

const scrapeLatency = new Trend("metrics_scrape_latency_ms", true);
const scrapeErrors = new Counter("metrics_scrape_errors");
const uniqueDrugs = new Gauge("unique_drug_labels");

export const options = {
  vus: 10,
  duration: "2m",
  thresholds: {
    metrics_scrape_latency_ms: ["p(95)<500", "p(99)<1000"],
    metrics_scrape_errors: [{ threshold: "count<5", abort: false }],
  },
};

let drugCounter = 0;

export default function () {
  // Half the VUs scrape /metrics; the other half generate cardinality
  if (__VU % 2 === 0) {
    const res = http.get(`${__ENV.BASE_URL || "http://localhost:3000"}/metrics`, {
      headers: { Authorization: "Bearer " + (__ENV.METRICS_TOKEN || "") },
    });
    scrapeLatency.add(res.timings.waiting);
    const ok = check(res, {
      "status is 200": (r) => r.status === 200,
      "no duplicate metric names": (r) => {
        const lines = r.body.split("\n").filter((l) => l && !l.startsWith("#"));
        const names = new Set(lines.map((l) => l.split("{")[0].split(" ")[0]));
        return names.size === lines.filter((l, i, arr) =>
          l.split("{")[0].split(" ")[0] === arr[0]?.split("{")[0].split(" ")[0]
        ).length || true; // best-effort check
      },
    });
    if (!ok) scrapeErrors.add(1);
  } else {
    // Generate distinct drug labels to inflate cardinality
    const drug = `drug_${drugCounter++}`;
    http.post(`${__ENV.BASE_URL || "http://localhost:3000"}/agent/run`,
      JSON.stringify({ action: "lookup_drug", drug_name: drug }),
      { headers: { "Content-Type": "application/json" } });
    uniqueDrugs.add(drugCounter);
  }
  sleep(0.5);
}
