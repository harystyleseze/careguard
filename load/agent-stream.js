/**
 * SSE load smoke test for /agent/stream (Issue #274).
 *
 * Opens many long-lived dashboard streams and verifies that each connection
 * receives the initial snapshot event without repeatedly polling HTTP routes.
 *
 * Usage:
 *   BASE_URL=http://localhost:3004 CONNECTIONS=1000 HOLD_MS=30000 npm run load:stream
 */

import http from "http";
import https from "https";

const BASE_URL = process.env.BASE_URL || "http://localhost:3004";
const CONNECTIONS = Number(process.env.CONNECTIONS || "1000");
const HOLD_MS = Number(process.env.HOLD_MS || "30000");
const RAMP_MS = Number(process.env.RAMP_MS || "5000");
const SNAPSHOT_TIMEOUT_MS = Number(process.env.SNAPSHOT_TIMEOUT_MS || "15000");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let opened = 0;
let snapshots = 0;
let failures = 0;
const requests = new Set();

function openStream(index) {
  return new Promise((resolve) => {
    const url = new URL("/agent/stream", BASE_URL);
    url.searchParams.set("limit", "1");
    url.searchParams.set("offset", "0");

    const client = url.protocol === "https:" ? https : http;
    let receivedSnapshot = false;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      if (!ok) failures += 1;
      resolve(ok);
    };
    const req = client.get(
      url,
      { headers: { Accept: "text/event-stream" } },
      (res) => {
        const contentType = String(res.headers["content-type"] || "");
        if (res.statusCode !== 200 || !contentType.includes("text/event-stream")) {
          finish(false);
          res.resume();
          return;
        }

        opened += 1;
        res.setEncoding("utf8");
        let buffer = "";
        res.on("data", (chunk) => {
          buffer = `${buffer}${chunk}`.slice(-4096);
          if (!receivedSnapshot && buffer.includes("event: snapshot")) {
            receivedSnapshot = true;
            snapshots += 1;
            finish(true);
          }
        });
        res.on("error", () => {
          finish(receivedSnapshot);
        });
      },
    );

    requests.add(req);
    req.setTimeout(HOLD_MS + SNAPSHOT_TIMEOUT_MS, () => {
      req.destroy(new Error("stream timed out"));
    });
    req.on("error", () => {
      finish(receivedSnapshot);
    });

    if (index === CONNECTIONS - 1) {
      process.stdout.write("\n");
    }
  });
}

const rampDelayMs = CONNECTIONS > 0 ? Math.floor(RAMP_MS / CONNECTIONS) : 0;
const attempts = [];

for (let i = 0; i < CONNECTIONS; i += 1) {
  attempts.push(openStream(i));
  if (rampDelayMs > 0) {
    await sleep(rampDelayMs);
  }
  if ((i + 1) % 100 === 0) {
    process.stdout.write(".");
  }
}

await Promise.race([
  Promise.all(attempts),
  sleep(SNAPSHOT_TIMEOUT_MS),
]);

await sleep(HOLD_MS);
for (const req of requests) {
  req.destroy();
}

const ok = opened === CONNECTIONS && snapshots === CONNECTIONS && failures === 0;

console.log(`=== CareGuard SSE Stream Load Summary ===
Target:      ${BASE_URL}/agent/stream
Connections: ${CONNECTIONS}
Opened:      ${opened}
Snapshots:   ${snapshots}
Failures:    ${failures}
Held for:    ${HOLD_MS}ms
Result:      ${ok ? "PASS" : "FAIL"}`);

process.exit(ok ? 0 : 1);
