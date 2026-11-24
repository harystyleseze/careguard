import { describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { register as defaultRegistry } from "prom-client";

// AGENT_CONCURRENCY is read at module load, so pin it before importing the queue.
vi.hoisted(() => {
  process.env.AGENT_CONCURRENCY = "2";
  delete process.env.METRICS_TOKEN;
});

const { agentQueue } = await import("../agent-queue.ts");
const { registry, metricsHandler } = await import("../metrics.ts");

const AGENT_CONCURRENCY = 2;

function buildApp() {
  const app = express();
  app.get("/metrics", metricsHandler());
  return app;
}

async function scrapeGauge(name: string): Promise<number | undefined> {
  const res = await supertest(buildApp()).get("/metrics");
  expect(res.status).toBe(200);
  const match = res.text.match(new RegExp(`^${name} (\\S+)$`, "m"));
  return match ? Number(match[1]) : undefined;
}

function gatedJob() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { run: () => agentQueue.enqueue(async () => gate), release };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("agent queue metrics on GET /metrics", () => {
  it("exposes agent_waiting_jobs when jobs are enqueued beyond AGENT_CONCURRENCY", async () => {
    const jobs = Array.from({ length: AGENT_CONCURRENCY + 1 }, gatedJob);
    const running = jobs.map((job) => job.run());
    await tick();

    expect(await scrapeGauge("agent_waiting_jobs")).toBe(1);

    jobs.forEach((job) => job.release());
    await Promise.all(running);
    expect(await scrapeGauge("agent_waiting_jobs")).toBe(0);
  });

  it("agent_queue_depth reflects the number of in-flight agent runs", async () => {
    expect(await scrapeGauge("agent_queue_depth")).toBe(0);

    const first = gatedJob();
    const firstRun = first.run();
    await tick();
    expect(await scrapeGauge("agent_queue_depth")).toBe(1);

    const second = gatedJob();
    const secondRun = second.run();
    await tick();
    expect(await scrapeGauge("agent_queue_depth")).toBe(2);

    first.release();
    await firstRun;
    expect(await scrapeGauge("agent_queue_depth")).toBe(1);

    second.release();
    await secondRun;
    expect(await scrapeGauge("agent_queue_depth")).toBe(0);
  });

  it("registers the gauges only on the custom registry without name collisions", async () => {
    const names = registry.getMetricsAsArray().map((metric) => metric.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => name === "agent_queue_depth")).toHaveLength(1);
    expect(names.filter((name) => name === "agent_waiting_jobs")).toHaveLength(1);

    expect(defaultRegistry.getSingleMetric("agent_queue_depth")).toBeUndefined();
    expect(defaultRegistry.getSingleMetric("agent_waiting_jobs")).toBeUndefined();
  });
});
