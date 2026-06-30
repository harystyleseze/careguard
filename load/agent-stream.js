/**
 * k6 SSE soak test for /agent/stream (Issue #804).
 *
 * Requires k6 with the community SSE extension:
 *   import sse from "k6/x/sse"
 *
 * Example:
 *   BASE_URL=http://localhost:3004 AGENT_API_KEY=dev-secret k6 run load/agent-stream.js
 */

import http from "k6/http";
import sse from "k6/x/sse";
import { check, sleep } from "k6";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";

function intEnv(name, fallback, min = 0) {
  const parsed = Number.parseInt(__ENV[name] || "", 10);
  if (Number.isFinite(parsed) && parsed >= min) return parsed;
  return fallback;
}

const BASE_URL = (__ENV.BASE_URL || "http://localhost:3004").replace(/\/$/, "");
const AGENT_API_KEY = __ENV.AGENT_API_KEY || "";
const METRICS_TOKEN = __ENV.METRICS_TOKEN || "";
const RECIPIENT_ID = __ENV.RECIPIENT_ID || "rosa";

const STREAM_CONNECTIONS = intEnv("STREAM_CONNECTIONS", 50, 1);
const STREAM_HOLD_SECONDS = intEnv("STREAM_HOLD_SECONDS", 30, 10);
const STREAM_BROADCASTS = intEnv("STREAM_BROADCASTS", 4, 1);
const BROADCAST_DELAY_SECONDS = intEnv("BROADCAST_DELAY_SECONDS", 5, 0);
const BROADCAST_INTERVAL_SECONDS = intEnv("BROADCAST_INTERVAL_SECONDS", 1, 0);
const MIN_EVENTS_PER_CLIENT = intEnv("MIN_EVENTS_PER_CLIENT", 3 + STREAM_BROADCASTS, 1);
const EXPECTED_STATUS_EVENTS = intEnv("EXPECTED_STATUS_EVENTS", 1 + STREAM_BROADCASTS, 1);
const MAX_RSS_DELTA_BYTES = intEnv("MAX_RSS_DELTA_BYTES", 64 * 1024 * 1024, 0);
const REQUEST_TIMEOUT_SECONDS = STREAM_HOLD_SECONDS + BROADCAST_DELAY_SECONDS + 45;

const sseConnectionsOpened = new Counter("sse_connections_opened");
const sseConnectionErrors = new Counter("sse_connection_errors");
const sseDeliverySuccessRate = new Rate("sse_delivery_success_rate");
const sseCleanDisconnectRate = new Rate("sse_clean_disconnect_rate");
const sseClientsReturnedToBaseline = new Rate("sse_clients_returned_to_baseline");
const sseRssMemoryWithinLimit = new Rate("sse_rss_memory_within_limit");
const sseTimeToFirstEvent = new Trend("sse_time_to_first_event_ms", true);
const sseConnectionLifetime = new Trend("sse_connection_lifetime_ms", true);
const broadcastSuccessRate = new Rate("broadcast_success_rate");
const broadcastLatency = new Trend("broadcast_latency_ms", true);
const broadcastEventsSent = new Counter("broadcast_events_sent");
const agentSseClientsGauge = new Gauge("observed_agent_sse_clients");
const processRssGauge = new Gauge("observed_process_resident_memory_bytes");

export const options = {
  scenarios: {
    sse_clients: {
      executor: "per-vu-iterations",
      vus: STREAM_CONNECTIONS,
      iterations: 1,
      exec: "sseClient",
      maxDuration: `${REQUEST_TIMEOUT_SECONDS + 15}s`,
      gracefulStop: "10s",
    },
    broadcaster: {
      executor: "shared-iterations",
      vus: 1,
      iterations: STREAM_BROADCASTS,
      exec: "broadcastEvents",
      startTime: `${BROADCAST_DELAY_SECONDS}s`,
      maxDuration: `${STREAM_BROADCASTS * (BROADCAST_INTERVAL_SECONDS + 5) + 30}s`,
      gracefulStop: "5s",
    },
  },
  thresholds: {
    sse_connection_errors: ["count==0"],
    sse_delivery_success_rate: ["rate>=0.95"],
    sse_clean_disconnect_rate: ["rate>=0.95"],
    sse_clients_returned_to_baseline: ["rate==1.0"],
    sse_rss_memory_within_limit: ["rate==1.0"],
    sse_time_to_first_event_ms: ["p(95)<2000"],
    broadcast_success_rate: ["rate==1.0"],
    broadcast_latency_ms: ["p(95)<1000"],
    "http_req_failed{scenario:broadcaster}": ["rate<0.01"],
  },
};

function authHeaders() {
  return AGENT_API_KEY ? { Authorization: `Bearer ${AGENT_API_KEY}` } : {};
}

function metricsHeaders() {
  return METRICS_TOKEN ? { Authorization: `Bearer ${METRICS_TOKEN}` } : {};
}

function streamUrl() {
  return `${BASE_URL}/agent/stream?recipient_id=${encodeURIComponent(RECIPIENT_ID)}`;
}

function metricValue(body, metricName) {
  for (const line of body.split("\n")) {
    if (line.startsWith(`${metricName} `)) {
      const value = Number.parseFloat(line.trim().split(/\s+/)[1]);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

function readMetricSnapshot() {
  const res = http.get(`${BASE_URL}/metrics`, {
    headers: metricsHeaders(),
    timeout: "5s",
    tags: { name: "metrics_snapshot" },
  });
  if (res.status !== 200) {
    return { ok: false, status: res.status, sseClients: null, rssBytes: null };
  }

  const sseClients = metricValue(res.body, "agent_sse_clients");
  const rssBytes = metricValue(res.body, "process_resident_memory_bytes");
  return {
    ok: sseClients !== null && rssBytes !== null,
    status: res.status,
    sseClients,
    rssBytes,
  };
}

function errorMessage(error) {
  try {
    if (error && typeof error.error === "function") return error.error();
    return String(error);
  } catch {
    return "unknown SSE error";
  }
}

export function setup() {
  const before = readMetricSnapshot();
  console.info(
    `SSE soak config: base=${BASE_URL}, connections=${STREAM_CONNECTIONS}, hold=${STREAM_HOLD_SECONDS}s, broadcasts=${STREAM_BROADCASTS}`
  );
  return { before };
}

export function sseClient() {
  let openedAt = Date.now();
  let firstEventAt = 0;
  let eventsSeen = 0;
  let statusEventsSeen = 0;
  let hadError = false;
  let closedCleanly = false;

  const response = sse.open(
    streamUrl(),
    {
      method: "GET",
      headers: authHeaders(),
      timeout: `${REQUEST_TIMEOUT_SECONDS}s`,
      tags: { endpoint: "agent_stream" },
    },
    function (client) {
      client.on("open", function () {
        openedAt = Date.now();
        sseConnectionsOpened.add(1);
      });

      client.on("event", function (event) {
        eventsSeen += 1;

        if (!firstEventAt) {
          firstEventAt = Date.now();
          sseTimeToFirstEvent.add(firstEventAt - openedAt);
        }

        if (event.name === "status") {
          statusEventsSeen += 1;
        }

        const heldLongEnough = Date.now() - openedAt >= STREAM_HOLD_SECONDS * 1000;
        const receivedEnoughEvents = eventsSeen >= MIN_EVENTS_PER_CLIENT;
        if (heldLongEnough && receivedEnoughEvents) {
          closedCleanly = true;
          client.close();
        }
      });

      client.on("error", function (error) {
        hadError = true;
        sseConnectionErrors.add(1);
        console.error(`SSE client ${__VU} error: ${errorMessage(error)}`);
      });
    }
  );

  const statusOk = check(response, {
    "SSE status is 200": (res) => res && res.status === 200,
  });
  const delivered =
    eventsSeen >= MIN_EVENTS_PER_CLIENT && statusEventsSeen >= EXPECTED_STATUS_EVENTS;

  if (!statusOk || response?.error) {
    console.error(`SSE client ${__VU} ended with status=${response?.status} error=${response?.error || ""}`);
  }

  sseConnectionLifetime.add(Date.now() - openedAt);
  sseDeliverySuccessRate.add(statusOk && delivered);
  sseCleanDisconnectRate.add(statusOk && delivered && closedCleanly && !hadError);
}

export function broadcastEvents() {
  const action = __ITER % 2 === 0 ? "pause" : "resume";
  const start = Date.now();
  const res = http.post(`${BASE_URL}/agent/${action}`, null, {
    headers: authHeaders(),
    timeout: "10s",
    tags: { name: `agent_${action}_broadcast` },
  });

  const ok = check(res, {
    [`POST /agent/${action} returned 200`]: (r) => r.status === 200,
    [`POST /agent/${action} returned JSON`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  broadcastLatency.add(Date.now() - start);
  broadcastSuccessRate.add(ok);
  if (ok) {
    broadcastEventsSent.add(1);
  } else {
    console.error(`Broadcast ${action} failed: status=${res.status} body=${String(res.body).slice(0, 200)}`);
  }

  sleep(BROADCAST_INTERVAL_SECONDS);
}

export function teardown(data) {
  sleep(2);
  const after = readMetricSnapshot();
  const before = data?.before;

  if (before?.ok && after.ok) {
    agentSseClientsGauge.add(after.sseClients);
    processRssGauge.add(after.rssBytes);

    const clientsReturned = after.sseClients <= before.sseClients;
    const rssDelta = after.rssBytes - before.rssBytes;
    const memoryWithinLimit = rssDelta <= MAX_RSS_DELTA_BYTES;

    sseClientsReturnedToBaseline.add(clientsReturned);
    sseRssMemoryWithinLimit.add(memoryWithinLimit);

    console.info(
      `SSE post-soak metrics: clients ${before.sseClients} -> ${after.sseClients}, rss delta ${rssDelta} bytes`
    );
  } else {
    sseClientsReturnedToBaseline.add(false);
    sseRssMemoryWithinLimit.add(false);
    console.warn(
      `Unable to verify /metrics baseline; before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
    );
  }
}

export function handleSummary(data) {
  const rate = (name) => ((data.metrics[name]?.values?.rate || 0) * 100).toFixed(1);
  const count = (name) => data.metrics[name]?.values?.count || 0;
  const p95 = (name) => data.metrics[name]?.values?.["p(95)"]?.toFixed(0) || "?";

  return {
    stdout: `
=== CareGuard SSE Soak Summary ===
Connections opened: ${count("sse_connections_opened")}
Broadcasts sent:    ${count("broadcast_events_sent")}
Delivery success:   ${rate("sse_delivery_success_rate")}%
Clean disconnects:  ${rate("sse_clean_disconnect_rate")}%
Connection errors:  ${count("sse_connection_errors")}
TTFE p95:           ${p95("sse_time_to_first_event_ms")}ms
Broadcast p95:      ${p95("broadcast_latency_ms")}ms
`,
  };
}
