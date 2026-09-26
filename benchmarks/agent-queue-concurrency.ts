import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BENCHMARK_PATH = fileURLToPath(import.meta.url);
const MOCK_LLM_PATH = join(ROOT, "services", "mock-llm", "server.ts");
const TEST_SECRET = "SAQDKF5AKPWQZRXGHLH523VC7DU46U7IEQNOALOUO2A2UR55NWPVDRGF";
const TEST_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const API_TASK = "Return a short benchmark confirmation without using a tool.";
const REQUEST_TIMEOUT_MS = 60_000;
const METRICS_SAMPLE_INTERVAL_MS = 5;

interface RequestResult {
  status: number;
  latencyMs: number;
  queueWaitMs: number;
}

interface MetricsSample {
  maxActive: number;
  maxWaiting: number;
  finalActive: number;
  finalWaiting: number;
}

interface RoundResult {
  requests: RequestResult[];
  wallMs: number;
  metrics: MetricsSample;
}

interface AggregateResult {
  agentConcurrency: number;
  maxQueueSize: number;
  requests: number;
  errors: number;
  rejected429: number;
  throughputRps: number;
  latency: { p50: number; p95: number; p99: number };
  queueWait: { p50: number; p95: number; p99: number };
  maxActive: number;
  maxWaiting: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function listEnv(name: string, fallback: number[]): number[] {
  const values = (process.env[name] ?? fallback.join(","))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length > 0 ? values : fallback;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function parseServerTiming(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  const match = raw.match(/agent-queue;dur=([0-9.]+)/);
  return match ? Number(match[1]) : Number.NaN;
}

function readMetric(text: string, name: string): number {
  const match = text.match(new RegExp(`^${name}(?:\\{[^\\n]*\\})?\\s+([-+0-9.eE]+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function launch(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (text.length > 0) process.stderr.write(`[benchmark child] ${text}`);
  });
  return child;
}

async function waitForHttp(child: ChildProcess, port: number, path: string): Promise<void> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`benchmark server exited with code ${child.exitCode ?? "signal"}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (response.ok) return;
      await response.arrayBuffer();
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`timed out waiting for ${path} on port ${port}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function startMockLlm(): Promise<{ child: ChildProcess; port: number }> {
  const port = await freePort();
  const child = launch(process.execPath, ["--import", "tsx", MOCK_LLM_PATH], {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MOCK_LLM_PORT: String(port),
    MOCK_LLM_DELAY_MS: String(positiveEnv("MOCK_LLM_DELAY_MS", 30)),
  });
  try {
    await waitForHttp(child, port, "/health");
    return { child, port };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function startServer(
  mockLlmPort: number,
  agentConcurrency: number,
  maxQueueSize: number,
): Promise<{ child: ChildProcess; port: number; dataDir: string }> {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "careguard-agent-benchmark-"));
  const child = launch(process.execPath, ["--import", "tsx", BENCHMARK_PATH, "--serve-queue"], {
    ...process.env,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MOCK_NETWORK: "1",
    STELLAR_NETWORK: "testnet",
    PORT: String(port),
    LLM_API_KEY: "benchmark-llm-key",
    LLM_BASE_URL: `http://127.0.0.1:${mockLlmPort}/v1`,
    LLM_MODEL: "mock-model",
    AGENT_SECRET_KEY: TEST_SECRET,
    PHARMACY_1_PUBLIC_KEY: TEST_PUBLIC_KEY,
    BILL_PROVIDER_PUBLIC_KEY: TEST_PUBLIC_KEY,
    MPP_SECRET_KEY: "benchmark-mpp-secret",
    CAREGIVER_TOKEN: "benchmark-caregiver-token",
    AGENT_API_KEY: "",
    AGENT_CONCURRENCY: String(agentConcurrency),
    MAX_QUEUE_SIZE: String(maxQueueSize),
    MAX_AGENT_ITERATIONS: "1",
    MAX_TOOL_CALLS_PER_RUN: "1",
    WALLET_BALANCE_CHECK_ENABLED: "0",
    DATA_DIR: dataDir,
    SENTRY_DSN: "",
  });
  try {
    await waitForHttp(child, port, "/health");
    return { child, port, dataDir };
  } catch (error) {
    await stopChild(child);
    rmSync(dataDir, { recursive: true, force: true });
    throw error;
  }
}

function requestRun(port: number, agent: http.Agent): Promise<RequestResult> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ task: API_TASK });
    const started = performance.now();
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/agent/run",
        agent,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            latencyMs: performance.now() - started,
            queueWaitMs: parseServerTiming(response.headers["server-timing"]),
          });
        });
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    request.once("error", reject);
    request.end(body);
  });
}

async function sampleMetrics(port: number, done: () => boolean): Promise<MetricsSample> {
  let maxActive = 0;
  let maxWaiting = 0;
  let finalActive = 0;
  let finalWaiting = 0;
  do {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      const text = await response.text();
      finalActive = readMetric(text, "agent_queue_depth");
      finalWaiting = readMetric(text, "agent_waiting_jobs");
      maxActive = Math.max(maxActive, finalActive);
      maxWaiting = Math.max(maxWaiting, finalWaiting);
    } catch {
      finalActive = 0;
      finalWaiting = 0;
    }
    if (!done()) await sleep(METRICS_SAMPLE_INTERVAL_MS);
  } while (!done());
  return { maxActive, maxWaiting, finalActive, finalWaiting };
}

async function runRound(port: number, total: number): Promise<RoundResult> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: total });
  let sampling = true;
  const metricsPromise = sampleMetrics(port, () => !sampling);
  const requests: RequestResult[] = [];
  try {
    let next = 0;
    async function worker(): Promise<void> {
      while (true) {
        const index = next++;
        if (index >= total) return;
        requests[index] = await requestRun(port, agent);
      }
    }
    const started = performance.now();
    await Promise.all(Array.from({ length: total }, worker));
    const wallMs = performance.now() - started;
    sampling = false;
    const metrics = await metricsPromise;
    return { requests, wallMs, metrics };
  } finally {
    sampling = false;
    agent.destroy();
  }
}

async function runConfiguration(
  mockLlmPort: number,
  agentConcurrency: number,
  maxQueueSize: number,
  rounds: number,
): Promise<AggregateResult> {
  const server = await startServer(mockLlmPort, agentConcurrency, maxQueueSize);
  try {
    const total = agentConcurrency + maxQueueSize;
    await runRound(server.port, Math.min(4, total));
    const results: RoundResult[] = [];
    for (let round = 0; round < rounds; round++) {
      results.push(await runRound(server.port, total));
    }
    const requests = results.flatMap((result) => result.requests);
    const latencies = requests.map((request) => request.latencyMs);
    const queueWaits = requests
      .map((request) => request.queueWaitMs)
      .filter((value) => Number.isFinite(value));
    const wallMs = results.reduce((sum, result) => sum + result.wallMs, 0);
    return {
      agentConcurrency,
      maxQueueSize,
      requests: requests.length,
      errors: requests.filter((request) => request.status >= 400).length,
      rejected429: requests.filter((request) => request.status === 429).length,
      throughputRps: wallMs > 0 ? (requests.length / wallMs) * 1_000 : 0,
      latency: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
      },
      queueWait: {
        p50: percentile(queueWaits, 50),
        p95: percentile(queueWaits, 95),
        p99: percentile(queueWaits, 99),
      },
      maxActive: Math.max(...results.map((result) => result.metrics.maxActive)),
      maxWaiting: Math.max(...results.map((result) => result.metrics.maxWaiting)),
    };
  } finally {
    await stopChild(server.child);
    rmSync(server.dataDir, { recursive: true, force: true });
  }
}

async function serveQueueChild(): Promise<void> {
  const express = (await import("express")).default;
  const { agentQueue } = await import("../shared/agent-queue.ts");
  const { metricsHandler } = await import("../shared/metrics.ts");
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/metrics", metricsHandler());
  app.post("/agent/run", async (req, res) => {
    const task = typeof req.body?.task === "string" ? req.body.task : API_TASK;
    const baseUrl = process.env.LLM_BASE_URL;
    if (!baseUrl) {
      res.status(500).json({ error: "LLM_BASE_URL is required" });
      return;
    }
    try {
      const result = await agentQueue.enqueue(
        async () => {
          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "mock-model",
              messages: [{ role: "user", content: task }],
            }),
          });
          if (!response.ok) {
            throw new Error(`mock LLM returned ${response.status}`);
          }
          return response.text();
        },
        (queueWaitMs) => {
          res.setHeader("Server-Timing", `agent-queue;dur=${queueWaitMs.toFixed(2)}`);
        },
      );
      res.json({ ok: true, result });
    } catch (error: any) {
      if (error?.status === 429) {
        res.status(429).set("Retry-After", String(error.retryAfter)).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error?.message ?? String(error) });
    }
  });
  const port = Number(process.env.PORT);
  const server = app.listen(port, "127.0.0.1", () => {
    process.stdout.write(`queue benchmark server listening on ${port}\n`);
  });
  server.on("error", (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
  process.once("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
}

function formatMs(value: number): string {
  return value.toFixed(1).padStart(7);
}

function printResult(result: AggregateResult): void {
  console.log(
    `| ${result.agentConcurrency} | ${result.maxQueueSize} | ${result.throughputRps.toFixed(1)} | ${formatMs(result.latency.p50)} | ${formatMs(result.latency.p95)} | ${formatMs(result.latency.p99)} | ${formatMs(result.queueWait.p50)} | ${formatMs(result.queueWait.p95)} | ${formatMs(result.queueWait.p99)} | ${result.maxWaiting} | ${result.rejected429} |`,
  );
}

async function main(): Promise<void> {
  const concurrencies = listEnv("AGENT_CONCURRENCIES", [1, 5, 10, 20]);
  const queueSizes = listEnv("MAX_QUEUE_SIZES", [10, 64]);
  const rounds = positiveEnv("ROUNDS", 3);
  const mock = await startMockLlm();
  const results: AggregateResult[] = [];
  try {
    console.log(`\nAgent queue concurrency benchmark`);
    console.log(`Node ${process.version} | ${rounds} rounds | mock delay ${positiveEnv("MOCK_LLM_DELAY_MS", 30)} ms`);
    console.log(`| server concurrency | max queue | requests/s | p50 ms | p95 ms | p99 ms | queue p50 ms | queue p95 ms | queue p99 ms | max waiting | 429 |`);
    console.log(`|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
    for (const agentConcurrency of concurrencies) {
      for (const maxQueueSize of queueSizes) {
        process.stderr.write(`running concurrency=${agentConcurrency}, queue=${maxQueueSize}...\n`);
        const result = await runConfiguration(
          mock.port,
          agentConcurrency,
          maxQueueSize,
          rounds,
        );
        results.push(result);
        printResult(result);
      }
    }
    const maxQueueP95 = Math.max(...results.map((result) => result.queueWait.p95));
    const rejected = results.reduce((sum, result) => sum + result.rejected429, 0);
    console.log(`\nMaximum queue-wait p95: ${maxQueueP95.toFixed(1)} ms; 429 responses: ${rejected}`);
    console.log(`Start with MAX_QUEUE_SIZE=64 and raise AGENT_CONCURRENCY only after checking LLM/provider limits.`);
  } finally {
    await stopChild(mock.child);
  }
}

const run = process.argv.includes("--serve-queue")
  ? serveQueueChild()
  : main();

run.catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
