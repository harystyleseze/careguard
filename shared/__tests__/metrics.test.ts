import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { metricsHandler } from "../metrics.ts";

function buildApp(metricsToken?: string) {
  const savedToken = process.env.METRICS_TOKEN;
  if (metricsToken !== undefined) {
    process.env.METRICS_TOKEN = metricsToken;
  } else {
    delete process.env.METRICS_TOKEN;
  }

  const app = express();
  app.get("/metrics", metricsHandler());

  // Restore env
  if (savedToken !== undefined) {
    process.env.METRICS_TOKEN = savedToken;
  } else {
    delete process.env.METRICS_TOKEN;
  }

  return app;
}

describe("/metrics endpoint", () => {
  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("returns 200 with Prometheus/OpenMetrics content", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain|openmetrics-text/);
  });

  it("output contains agent_runs_total", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/metrics");
    expect(res.text).toContain("agent_runs_total");
  });

  it("output contains LLM call and latency metrics", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/metrics");
    expect(res.text).toContain("agent_llm_calls_total");
    expect(res.text).toContain("agent_llm_latency_seconds");
  });

  it("output contains nodejs_eventloop_lag_seconds from default metrics", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/metrics");
    expect(res.text).toContain("nodejs_eventloop_lag_seconds");
  });

  it("returns 401 when METRICS_TOKEN is set and no auth header provided", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const app = express();
    app.get("/metrics", metricsHandler());
    const res = await supertest(app).get("/metrics");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("returns 200 with valid Bearer token", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const app = express();
    app.get("/metrics", metricsHandler());
    const res = await supertest(app)
      .get("/metrics")
      .set("Authorization", "Bearer secret-token");
    expect(res.status).toBe(200);
    expect(res.text).toContain("agent_runs_total");
  });

  it("returns 401 with wrong token", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const app = express();
    app.get("/metrics", metricsHandler());
    const res = await supertest(app)
      .get("/metrics")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });
});
