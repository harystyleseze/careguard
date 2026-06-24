import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";

// Capture log output by spying on the logger
vi.mock("../logger.ts", () => {
  const calls: { level: string; msg: string; data: Record<string, unknown> }[] = [];
  const makeMethod = (level: string) => (data: Record<string, unknown>, msg: string) => {
    calls.push({ level, msg, data });
  };
  return {
    log: {
      error: makeMethod("error"),
      warn: makeMethod("warn"),
      info: makeMethod("info"),
      debug: makeMethod("debug"),
    },
    __calls: calls,
  };
});

import { requestLoggerMiddleware } from "../request-logger.ts";
// @ts-expect-error — test-only export
import { __calls } from "../logger.ts";

function buildApp(status: number, path = "/test") {
  const app = express();
  app.use(requestLoggerMiddleware());
  app.get(path, (_req, res) => res.status(status).json({ ok: true }));
  app.post(path, (_req, res) => res.status(status).json({ ok: true }));
  return app;
}

describe("requestLoggerMiddleware", () => {
  beforeEach(() => {
    __calls.length = 0;
  });

  it("logs at info level for 2xx responses", async () => {
    await supertest(buildApp(200)).get("/test");
    const entry = __calls.find((c: any) => c.msg === "http");
    expect(entry?.level).toBe("info");
    expect(entry?.data.status).toBe(200);
  });

  it("logs at error level for 5xx responses", async () => {
    await supertest(buildApp(500)).get("/test");
    const entry = __calls.find((c: any) => c.msg === "http");
    expect(entry?.level).toBe("error");
    expect(entry?.data.status).toBe(500);
  });

  it("logs at warn level for 4xx on sensitive path /agent/run", async () => {
    await supertest(buildApp(400, "/agent/run")).post("/agent/run");
    const entry = __calls.find((c: any) => c.msg === "http");
    expect(entry?.level).toBe("warn");
  });

  it("logs at info level for 4xx on non-sensitive paths", async () => {
    await supertest(buildApp(404)).get("/test");
    const entry = __calls.find((c: any) => c.msg === "http");
    expect(entry?.level).toBe("info");
  });

  it("log data includes method, path, status, duration_ms", async () => {
    await supertest(buildApp(200)).get("/test");
    const entry = __calls.find((c: any) => c.msg === "http");
    expect(entry?.data).toMatchObject({
      method: "GET",
      path: "/test",
      status: 200,
    });
    expect(typeof entry?.data.duration_ms).toBe("number");
  });
});
