/**
 * Tests for issue #92 — explicit Express body-size limits.
 *
 * Tests the middleware configuration directly (no LLM/Stellar mocks needed).
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

function buildApp(defaultLimit: string, billAuditLimit?: string) {
  const app = express();
  if (billAuditLimit) {
    const smallJson = express.json({ limit: defaultLimit });
    const largeJson = express.json({ limit: billAuditLimit });
    app.use((req: any, res: any, next: any) =>
      (req.path.startsWith("/bill/audit") ? largeJson : smallJson)(req, res, next)
    );
  } else {
    app.use(express.json({ limit: defaultLimit }));
  }
  app.post("/agent/run", (req, res) => res.json({ ok: true }));
  app.post("/bill/audit", (req, res) => res.json({ ok: true }));
  // 413 error handler
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large", limit: err.limit });
    }
    next(err);
  });
  return app;
}

const oversized = JSON.stringify({ data: "x".repeat(70_000) });    // ~70kb
const medium    = JSON.stringify({ data: "x".repeat(200_000) });   // ~200kb
const small     = JSON.stringify({ task: "Check drug prices" });

describe("#92 body-size limit — 64kb default", () => {
  const app = buildApp("64kb");

  it("returns 413 when POST body exceeds 64kb", async () => {
    const res = await request(app)
      .post("/agent/run")
      .set("Content-Type", "application/json")
      .send(oversized);

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("does not 413 when body is within 64kb", async () => {
    const res = await request(app)
      .post("/agent/run")
      .set("Content-Type", "application/json")
      .send(small);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("#92 body-size limit — bill-audit route gets 256kb", () => {
  const app = buildApp("20kb", "256kb");

  it("allows ~200kb on /bill/audit", async () => {
    const res = await request(app)
      .post("/bill/audit")
      .set("Content-Type", "application/json")
      .send(medium);

    expect(res.status).toBe(200);
  });

  it("still 413 on non-bill route with 70kb oversized body", async () => {
    const res = await request(app)
      .post("/agent/run")
      .set("Content-Type", "application/json")
      .send(oversized);

    expect(res.status).toBe(413);
  });

  it("413 on /bill/audit above 256kb", async () => {
    const huge = JSON.stringify({ data: "x".repeat(300_000) }); // ~300kb
    const res = await request(app)
      .post("/bill/audit")
      .set("Content-Type", "application/json")
      .send(huge);

    expect(res.status).toBe(413);
  });
});
