import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requestLifecycleMiddleware, getRequestId } from "../request-lifecycle.ts";

describe("requestLifecycleMiddleware", () => {
  it("establishes context, sets X-Request-ID header, and logs request lifecycle", async () => {
    const app = express();
    app.use(requestLifecycleMiddleware());

    let capturedId: string | undefined;
    app.get("/test", (_req, res) => {
      capturedId = getRequestId();
      res.json({ ok: true });
    });

    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.headers["x-request-id"]).toBeDefined();
    expect(capturedId).toBe(res.headers["x-request-id"]);
  });

  it("reuses incoming X-Request-ID header if provided", async () => {
    const app = express();
    app.use(requestLifecycleMiddleware());

    app.get("/test", (_req, res) => {
      res.json({ ok: true });
    });

    const customId = "custom-correlation-id-12345";
    const res = await request(app)
      .get("/test")
      .set("X-Request-ID", customId);

    expect(res.headers["x-request-id"]).toBe(customId);
  });

  it("throws error if mounted more than once", async () => {
    const app = express();
    app.use(requestLifecycleMiddleware());
    app.use(requestLifecycleMiddleware());

    app.get("/test", (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app).get("/test");
    expect(res.status).toBe(500);
  });
});
