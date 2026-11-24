/**
 * Benchmark: cumulative overhead of the security middleware chain (#1313)
 *
 * Rebuilds the unified server's global middleware chain from server.ts one
 * layer at a time and measures real HTTP latency/throughput for each stage:
 *
 *   0 baseline      bare express + route handler
 *   1 rate-limit    + express-rate-limit (agent + default policies)
 *   2 helmet        + applySecurityMiddleware (shared/security-middleware.ts)
 *   3 cors          + createCorsMiddleware (shared/cors.ts)
 *   4 json          + path-selected express.json body parser
 *   5 lifecycle     + requestLifecycleMiddleware (request id, ALS, pino log line)
 *   6 api-key       + requireApiKey on /agent (full chain)
 *
 * Each stage runs in its own child process (so the load generator doesn't
 * share an event loop with the server) and is driven over keep-alive HTTP at
 * several concurrency levels. The per-middleware cost is the delta between
 * consecutive stages.
 *
 * Notes:
 * - Rate limiters use the real createRateLimiter() with a very high max so
 *   the benchmark measures the counting cost, not 429 responses.
 * - Sentry is omitted: initSentry() returns a no-op unless SENTRY_DSN is set.
 * - Servers run with NODE_ENV=production so logging is plain JSON pino
 *   (no pino-pretty worker) and helmet sends HSTS, as in production. Log
 *   output goes to /dev/null.
 *
 * Run: node --import tsx benchmarks/security-middleware-overhead.ts
 *      MODE=isolated ISO_ITERATIONS=50000 node --import tsx benchmarks/security-middleware-overhead.ts
 *      REQUESTS=5000 CONCURRENCY=1,10,50 ROUNDS=3 node --import tsx benchmarks/security-middleware-overhead.ts
 */

import http from "node:http";
import net from "node:net";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import type { AddressInfo } from "node:net";

const STAGES = [
  "baseline",
  "rate-limit",
  "helmet",
  "cors",
  "json",
  "lifecycle",
  "api-key",
] as const;
type Stage = (typeof STAGES)[number];

const API_KEY = "bench-api-key-0123456789abcdef";
const REQUESTS = Number(process.env.REQUESTS ?? 4000);
const WARMUP = Math.min(500, Math.floor(REQUESTS / 4));
const CONCURRENCY = (process.env.CONCURRENCY ?? "1,10,50")
  .split(",")
  .map(Number);
// Each cell is measured ROUNDS times; the round with the median mean latency is reported.
const ROUNDS = Number(process.env.ROUNDS ?? 3);
// MODE=http | isolated | both (default)
const MODE = process.env.MODE ?? "both";
const ISO_ITERATIONS = Number(process.env.ISO_ITERATIONS ?? 20_000);

// ─── Server side (child process) ─────────────────────────────────────────────

type Layer = Exclude<Stage, "baseline">;

/** Build an express app with the given layers, applied in server.ts order. */
async function buildApp(layers: Layer[]) {
  const { default: express } = await import("express");
  const has = (l: Layer) => layers.includes(l);
  const app = express();

  if (has("rate-limit")) {
    const { createRateLimiter } = await import("../shared/rate-limit.ts");
    app.use("/agent", createRateLimiter("agent", 1e9));
    app.use(createRateLimiter("default", 1e9));
  }
  if (has("helmet")) {
    const { applySecurityMiddleware } =
      await import("../shared/security-middleware.ts");
    applySecurityMiddleware(app);
  }
  if (has("cors")) {
    const { createCorsMiddleware } = await import("../shared/cors.ts");
    app.use(createCorsMiddleware());
  }
  if (has("json")) {
    const small = express.json({ limit: "20kb" });
    const large = express.json({ limit: "256kb" });
    app.use((req, res, next) =>
      (req.path.startsWith("/bill/audit") ? large : small)(req, res, next),
    );
  }
  if (has("lifecycle")) {
    const { requestLifecycleMiddleware } =
      await import("../shared/request-lifecycle.ts");
    app.use(requestLifecycleMiddleware());
  }
  if (has("api-key")) {
    const { requireApiKey } = await import("../shared/auth.ts");
    app.use("/agent", requireApiKey);
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.post("/agent/echo", (req, res) => {
    res.json({
      ok: true,
      n: Array.isArray(req.body?.meds) ? req.body.meds.length : 0,
    });
  });

  return app;
}

async function serve(stage: Stage): Promise<void> {
  const layers = STAGES.slice(1, STAGES.indexOf(stage) + 1) as Layer[];
  const app = await buildApp(layers);
  const server = app.listen(0, "127.0.0.1", () => {
    process.send!({ port: (server.address() as AddressInfo).port });
  });
}

// ─── Client side (parent process) ────────────────────────────────────────────

interface Target {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
}

const TARGETS: Target[] = [
  { name: "GET /health", method: "GET", path: "/health" },
  {
    name: "POST /agent/echo",
    method: "POST",
    path: "/agent/echo",
    body: JSON.stringify({
      meds: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
    }),
  },
];

interface Result {
  stage: Stage;
  target: string;
  concurrency: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

// ─── Isolated per-middleware cost (child process) ────────────────────────────
//
// HTTP round-trips on a shared dev machine are noisy at the sub-0.1 ms level,
// so each layer is also measured on its own, in-process: an express app with
// just that layer (plus the route) is invoked directly with an unconnected
// IncomingMessage/ServerResponse pair, timing until the handler calls
// res.end(). This isolates the middleware's own CPU cost from socket I/O.

function invoke(
  app: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  t: Target,
): Promise<number> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    Object.defineProperty(sock, "remoteAddress", { value: "127.0.0.1" });
    const req = new http.IncomingMessage(sock);
    req.method = t.method;
    req.url = t.path;
    req.headers = {
      host: "127.0.0.1",
      origin: "http://localhost:3000",
      authorization: `Bearer ${API_KEY}`,
    };
    if (t.body) {
      req.headers["content-type"] = "application/json";
      req.headers["content-length"] = String(Buffer.byteLength(t.body));
      req.push(t.body);
    }
    req.push(null);
    const res = new http.ServerResponse(req);
    const t0 = performance.now();
    (res as any).end = function () {
      const dt = performance.now() - t0;
      // Fire listeners (request-lifecycle logs on "finish") like a real response.
      res.emit("finish");
      resolve(dt);
      return this;
    };
    app(req, res);
  });
}

async function isolated(): Promise<void> {
  const cases: { name: string; layers: Layer[] }[] = [
    { name: "baseline", layers: [] },
    ...(STAGES.slice(1) as Layer[]).map((l) => ({ name: l, layers: [l] })),
    { name: "full chain", layers: STAGES.slice(1) as Layer[] },
  ];
  const us = (ms: number) => (ms * 1000).toFixed(1);

  console.error(
    `\nIsolated per-middleware cost — ${ISO_ITERATIONS} in-process invocations per cell (µs)\n`,
  );
  for (const t of TARGETS) {
    console.error(t.name);
    console.error(
      "| layer | mean µs | p50 µs | p99 µs | Δ mean vs baseline (µs) |",
    );
    console.error("|---|---:|---:|---:|---:|");
    let baseMean = 0;
    for (const c of cases) {
      const app = (await buildApp(c.layers)) as any;
      for (let i = 0; i < 2000; i++) await invoke(app, t);
      const xs: number[] = [];
      for (let i = 0; i < ISO_ITERATIONS; i++) xs.push(await invoke(app, t));
      xs.sort((a, b) => a - b);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      if (c.name === "baseline") baseMean = mean;
      console.error(
        `| ${c.name} | ${us(mean)} | ${us(percentile(xs, 50))} | ${us(percentile(xs, 99))} | ${c.name === "baseline" ? "—" : us(mean - baseMean)} |`,
      );
    }
    console.error();
  }
}

function request(agent: http.Agent, port: number, t: Target): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      origin: "http://localhost:3000",
      authorization: `Bearer ${API_KEY}`,
    };
    if (t.body) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(t.body));
    }
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: t.method,
        path: t.path,
        agent,
        headers,
      },
      (res) => {
        if (res.statusCode !== 200)
          reject(new Error(`${t.path} -> ${res.statusCode}`));
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.end(t.body);
  });
}

async function drive(
  port: number,
  t: Target,
  concurrency: number,
  total: number,
): Promise<number[] & { wallMs?: number }> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const latencies: number[] = [];
  let issued = 0;
  const start = performance.now();
  async function worker() {
    while (issued < total) {
      issued++;
      const t0 = performance.now();
      await request(agent, port, t);
      latencies.push(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wallMs = performance.now() - start;
  agent.destroy();
  return Object.assign(latencies, { wallMs });
}

function startServer(
  stage: Stage,
): Promise<{ child: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ["--serve", stage], {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        AGENT_API_KEY: API_KEY,
        DASHBOARD_ORIGIN: "http://localhost:3000",
      },
    });
    child.once("message", (m: any) => resolve({ child, port: m.port }));
    child.once("error", reject);
    child.once(
      "exit",
      (code) =>
        code && reject(new Error(`${stage} server exited with ${code}`)),
    );
  });
}

function runIsolatedChild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ["--isolated"], {
      execArgv: ["--import", "tsx"],
      // Keep production logging on (request-lifecycle writes a pino line per
      // request) but discard it; the results table is printed to stderr.
      stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        AGENT_API_KEY: API_KEY,
        DASHBOARD_ORIGIN: "http://localhost:3000",
      },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code ? reject(new Error(`isolated run exited with ${code}`)) : resolve(),
    );
  });
}

async function main(): Promise<void> {
  if (MODE !== "http") await runIsolatedChild();
  if (MODE === "isolated") return;
  const results: Result[] = [];

  for (const stage of STAGES) {
    const { child, port } = await startServer(stage);
    try {
      for (const t of TARGETS) {
        await drive(port, t, 1, WARMUP);
        for (const c of CONCURRENCY) {
          const rounds: Result[] = [];
          for (let r = 0; r < ROUNDS; r++) {
            const lat = await drive(port, t, c, REQUESTS);
            const sorted = [...lat].sort((a, b) => a - b);
            rounds.push({
              stage,
              target: t.name,
              concurrency: c,
              rps: Math.round((REQUESTS / lat.wallMs!) * 1000),
              p50: percentile(sorted, 50),
              p95: percentile(sorted, 95),
              p99: percentile(sorted, 99),
              mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
            });
          }
          rounds.sort((a, b) => a.mean - b.mean);
          results.push(rounds[Math.floor(rounds.length / 2)]!);
        }
      }
    } finally {
      child.kill();
    }
  }

  const f = (ms: number) => ms.toFixed(3);
  console.log(
    `\nSecurity middleware chain overhead (#1313) — ${REQUESTS} requests per cell, median of ${ROUNDS} rounds, node ${process.version}\n`,
  );
  for (const t of TARGETS) {
    for (const c of CONCURRENCY) {
      console.log(`${t.name} @ concurrency ${c}`);
      console.log(
        "| stage | rps | mean ms | p50 ms | p95 ms | p99 ms | Δ mean vs prev stage (ms) | Δ mean vs baseline (ms) |",
      );
      console.log("|---|---:|---:|---:|---:|---:|---:|---:|");
      const rows = results.filter(
        (r) => r.target === t.name && r.concurrency === c,
      );
      rows.forEach((r, i) => {
        const prev = i === 0 ? r.mean : rows[i - 1]!.mean;
        console.log(
          `| ${r.stage} | ${r.rps} | ${f(r.mean)} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} | ${i === 0 ? "—" : f(r.mean - prev)} | ${i === 0 ? "—" : f(r.mean - rows[0]!.mean)} |`,
        );
      });
      console.log();
    }
  }
}

const serveIdx = process.argv.indexOf("--serve");
if (process.argv.includes("--isolated")) {
  await isolated();
} else if (serveIdx !== -1) {
  await serve(process.argv[serveIdx + 1] as Stage);
} else {
  await main();
}
