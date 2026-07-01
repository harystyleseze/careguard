import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";

// ── Redis mock (must be hoisted before module imports) ────────────────────────
const mockCache = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    _store: store,
  };
});

vi.mock("../redis.ts", () => mockCache);

import { verifyWebhook, computeWebhookSignature } from "../verify-webhook.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = "test-secret-abc";
const BODY = JSON.stringify({ amount: "10", asset: "USDC" });

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function makeSignature(secret: string, ts: string, body: string): string {
  const hex = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `sha256=${hex}`;
}

function buildApp(opts?: Parameters<typeof verifyWebhook>[0]) {
  const app = express();
  app.use(express.json());
  app.post(
    "/webhooks/stellar/deposit",
    verifyWebhook(opts),
    (_req, res) => res.status(200).json({ status: "ok" }),
  );
  return app;
}

function validHeaders(overrides: Record<string, string> = {}) {
  const ts = nowSeconds();
  return {
    "content-type": "application/json",
    "x-webhook-timestamp": ts,
    "x-webhook-id": "evt_unique_123",
    "x-webhook-signature": makeSignature(SECRET, ts, BODY),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("verifyWebhook", () => {
  beforeEach(() => {
    mockCache._store.clear();
    mockCache.get.mockClear();
    mockCache.set.mockClear();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("passes a valid signed request through to the handler", async () => {
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set(validHeaders())
      .send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("stores the webhook-id in cache after processing", async () => {
    await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set(validHeaders())
      .send(BODY);

    expect(mockCache.set).toHaveBeenCalledWith(
      expect.stringContaining("evt_unique_123"),
      "1",
      expect.any(Number),
    );
  });

  // ── Wrong signature ─────────────────────────────────────────────────────────

  it("returns 400 for a wrong signature", async () => {
    const ts = nowSeconds();
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": ts,
        "x-webhook-id": "evt_bad_sig",
        "x-webhook-signature": makeSignature("wrong-secret", ts, BODY),
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid webhook signature/i);
  });

  it("returns 400 for a malformed signature header (no sha256= prefix)", async () => {
    const ts = nowSeconds();
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": ts,
        "x-webhook-id": "evt_malformed",
        "x-webhook-signature": "not-a-valid-signature",
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/malformed/i);
  });

  // ── Stale timestamp ─────────────────────────────────────────────────────────

  it("returns 400 when timestamp is older than 5 minutes", async () => {
    const staleTs = String(Math.floor((Date.now() - 6 * 60 * 1000) / 1000));
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": staleTs,
        "x-webhook-id": "evt_stale",
        "x-webhook-signature": makeSignature(SECRET, staleTs, BODY),
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp outside/i);
  });

  it("returns 400 when timestamp is in the future beyond 5 minutes", async () => {
    const futureTs = String(Math.floor((Date.now() + 6 * 60 * 1000) / 1000));
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": futureTs,
        "x-webhook-id": "evt_future",
        "x-webhook-signature": makeSignature(SECRET, futureTs, BODY),
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/timestamp outside/i);
  });

  it("returns 400 for non-numeric timestamp", async () => {
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": "not-a-number",
        "x-webhook-id": "evt_nonnumeric",
        "x-webhook-signature": `sha256=${"a".repeat(64)}`,
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  // ── Missing headers ─────────────────────────────────────────────────────────

  it("returns 400 when X-Webhook-Signature is missing", async () => {
    const headers = validHeaders();
    delete (headers as any)["x-webhook-signature"];
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set(headers)
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it("returns 400 when X-Webhook-Timestamp is missing", async () => {
    const headers = validHeaders();
    delete (headers as any)["x-webhook-timestamp"];
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set(headers)
      .send(BODY);

    expect(res.status).toBe(400);
  });

  it("returns 400 when X-Webhook-Id is missing", async () => {
    const headers = validHeaders();
    delete (headers as any)["x-webhook-id"];
    const res = await request(buildApp({ secret: SECRET }))
      .post("/webhooks/stellar/deposit")
      .set(headers)
      .send(BODY);

    expect(res.status).toBe(400);
  });

  // ── Replay protection ───────────────────────────────────────────────────────

  it("returns 200 no-op for a replayed webhook-id", async () => {
    const app = buildApp({ secret: SECRET });
    const headers = validHeaders({ "x-webhook-id": "evt_replay_test" });

    // First request succeeds normally
    const first = await request(app)
      .post("/webhooks/stellar/deposit")
      .set(headers)
      .send(BODY);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "ok" });

    // Simulate the id being in cache (as the set mock stored it)
    // Second request is a replay → 200 no-op
    const second = await request(app)
      .post("/webhooks/stellar/deposit")
      .set(headers)
      .send(BODY);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: "already_processed" });
  });

  it("does not advance to the handler on replay", async () => {
    const handler = vi.fn((_req: any, res: any) => res.status(200).json({ status: "ok" }));
    const app = express();
    app.use(express.json());
    app.post("/webhooks/stellar/deposit", verifyWebhook({ secret: SECRET }), handler);

    const headers = validHeaders({ "x-webhook-id": "evt_no_handler" });

    await request(app).post("/webhooks/stellar/deposit").set(headers).send(BODY);
    expect(handler).toHaveBeenCalledTimes(1);

    await request(app).post("/webhooks/stellar/deposit").set(headers).send(BODY);
    expect(handler).toHaveBeenCalledTimes(1); // NOT called again
  });

  // ── No secret configured ────────────────────────────────────────────────────

  it("returns 400 when secret is empty string", async () => {
    const ts = nowSeconds();
    const res = await request(buildApp({ secret: "" }))
      .post("/webhooks/stellar/deposit")
      .set({
        "content-type": "application/json",
        "x-webhook-timestamp": ts,
        "x-webhook-id": "evt_nosecret",
        "x-webhook-signature": makeSignature("", ts, BODY),
      })
      .send(BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/secret not configured/i);
  });

  // ── computeWebhookSignature helper ──────────────────────────────────────────

  it("computeWebhookSignature produces the correct sha256= prefixed hex", () => {
    const ts = "1700000000";
    const body = '{"foo":"bar"}';
    const sig = computeWebhookSignature(SECRET, ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);

    const expected = `sha256=${createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex")}`;
    expect(sig).toBe(expected);
  });
});
