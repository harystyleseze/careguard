import { describe, it, expect } from "vitest";
import express from "express";
import supertest from "supertest";
import {
  withRequestContext,
  getRequestId,
  getAgentRunId,
  setAgentRunId,
  requestContextMiddleware,
} from "../request-context.ts";

describe("withRequestContext / getRequestId", () => {
  it("makes the ID available synchronously inside the callback", () => {
    withRequestContext("req-1", () => {
      expect(getRequestId()).toBe("req-1");
    });
  });

  it("propagates through awaited async calls", async () => {
    let captured: string | undefined;
    await withRequestContext("req-async", async () => {
      await Promise.resolve();
      captured = getRequestId();
    });
    expect(captured).toBe("req-async");
  });

  it("restores the outer context after the inner call exits", () => {
    withRequestContext("outer", () => {
      withRequestContext("inner", () => {
        expect(getRequestId()).toBe("inner");
      });
      expect(getRequestId()).toBe("outer");
    });
  });

  it("returns undefined outside any context", () => {
    expect(getRequestId()).toBeUndefined();
  });

  it("concurrent contexts do not bleed into each other", async () => {
    const results: string[] = [];

    await Promise.all([
      withRequestContext("req-A", async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getRequestId()!);
      }),
      withRequestContext("req-B", async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(getRequestId()!);
      }),
    ]);

    expect(results).toContain("req-A");
    expect(results).toContain("req-B");
    expect(results[0]).not.toBe(results[1]);
  });
});

describe("setAgentRunId / getAgentRunId", () => {
  it("sets and retrieves agentRunId inside a context", () => {
    withRequestContext("req-2", () => {
      setAgentRunId("run-42");
      expect(getAgentRunId()).toBe("run-42");
    });
  });

  it("returns undefined outside any context", () => {
    expect(getAgentRunId()).toBeUndefined();
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("requestContextMiddleware", () => {
  function buildApp() {
    const app = express();
    app.use(requestContextMiddleware());
    app.get("/test", (req, res) => res.json({ requestId: getRequestId(), reqRequestId: req.requestId }));
    return app;
  }

  it("sets X-Request-ID response header", async () => {
    const res = await supertest(buildApp()).get("/test");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(typeof res.headers["x-request-id"]).toBe("string");
  });

  it("generates a UUID v4 when no incoming header is present", async () => {
    const res = await supertest(buildApp()).get("/test");
    expect(res.headers["x-request-id"]).toMatch(UUID_RE);
  });

  it("sets req.requestId on the request object", async () => {
    const res = await supertest(buildApp()).get("/test");
    expect(res.body.reqRequestId).toBeTruthy();
    expect(res.body.reqRequestId).toBe(res.headers["x-request-id"]);
  });

  it("req.requestId matches the AsyncLocalStorage value", async () => {
    const res = await supertest(buildApp()).get("/test");
    expect(res.body.reqRequestId).toBe(res.body.requestId);
  });

  it("reuses x-request-id from incoming request header", async () => {
    const res = await supertest(buildApp())
      .get("/test")
      .set("x-request-id", "my-custom-id");
    expect(res.headers["x-request-id"]).toBe("my-custom-id");
    expect(res.body.requestId).toBe("my-custom-id");
    expect(res.body.reqRequestId).toBe("my-custom-id");
  });

  it("generates a different ID for each request when no header is present", async () => {
    const app = buildApp();
    const [res1, res2] = await Promise.all([
      supertest(app).get("/test"),
      supertest(app).get("/test"),
    ]);
    expect(res1.headers["x-request-id"]).toBeTruthy();
    expect(res2.headers["x-request-id"]).toBeTruthy();
    expect(res1.headers["x-request-id"]).not.toBe(res2.headers["x-request-id"]);
  });
});
