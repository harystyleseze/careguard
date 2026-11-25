/**
 * Contract test: Inbound Stellar deposit webhook HMAC signature and body schema (Issue #988).
 *
 * Automates step 4 ("Verify with a test event") of docs/runbooks/webhook-secret-rotation.md.
 * Pins the contract between webhook senders (or rotation operators) and shared/verify-webhook.ts,
 * verifying POST /webhooks/stellar/deposit accepts the runbook's exact curl schema with 200 { status: "received" },
 * and correctly rejects wrong signatures, timestamp drifts, and replayed event IDs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";

// Hoist Redis cache mock for replay detection
const mockCache = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    _store: store,
  };
});

vi.mock("../shared/redis.ts", () => mockCache);

import { verifyWebhook } from "../shared/verify-webhook.ts";

/**
 * Creates an Express app mounting POST /webhooks/stellar/deposit with the exact
 * middleware stack and response structure used in agent/server.ts:987-1013.
 */
function createDepositWebhookApp(secret: string) {
  const app = express();
  app.post(
    "/webhooks/stellar/deposit",
    express.raw({ type: "application/json" }),
    verifyWebhook({ secret }),
    (req: express.Request, res: express.Response) => {
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : String(req.body);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: "Invalid JSON in webhook payload" });
        return;
      }
      res.status(200).json({ status: "received" });
    },
  );
  return app;
}

describe("Stellar Deposit Webhook Contract — Runbook Step 4 (Issue #988)", () => {
  const SECRET = "rotation-new-secret-xyz-789";
  // Exact payload body from docs/runbooks/webhook-secret-rotation.md:82
  const RUNBOOK_BODY = '{"amount":"1","asset":"USDC","tx":"test"}';

  beforeEach(() => {
    mockCache._store.clear();
    mockCache.get.mockClear();
    mockCache.set.mockClear();
  });

  function computeHmacSignature(secret: string, timestamp: string | number, body: string): string {
    const digest = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    return `sha256=${digest}`;
  }

  it("accepts valid request using exact header and body schema from runbook with 200 { status: 'received' }", async () => {
    const app = createDepositWebhookApp(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const eventId = `rotation-test-${ts}`;
    const sig = computeHmacSignature(SECRET, ts, RUNBOOK_BODY);

    const res = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "received" });
    // Verify event ID is cached in Redis with replay prefix
    expect(mockCache.set).toHaveBeenCalledWith(
      `webhook:seen:${eventId}`,
      "1",
      expect.any(Number),
    );
  });

  it("rejects request with wrong signature (400 invalid webhook signature)", async () => {
    const app = createDepositWebhookApp(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const eventId = `rotation-test-${ts}`;
    const wrongSig = computeHmacSignature("wrong-secret-key", ts, RUNBOOK_BODY);

    const res = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", wrongSig)
      .send(RUNBOOK_BODY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid webhook signature" });
  });

  it("rejects request when timestamp is older than ±5 minute tolerance (stale event)", async () => {
    const app = createDepositWebhookApp(SECRET);
    // 5 minutes and 1 second ago (301 seconds)
    const staleTs = Math.floor(Date.now() / 1000) - 301;
    const eventId = `rotation-test-${staleTs}`;
    const sig = computeHmacSignature(SECRET, staleTs, RUNBOOK_BODY);

    const res = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(staleTs))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "webhook timestamp outside allowed window" });
  });

  it("rejects request when timestamp is in future beyond ±5 minute tolerance", async () => {
    const app = createDepositWebhookApp(SECRET);
    // 5 minutes and 1 second in the future
    const futureTs = Math.floor(Date.now() / 1000) + 301;
    const eventId = `rotation-test-${futureTs}`;
    const sig = computeHmacSignature(SECRET, futureTs, RUNBOOK_BODY);

    const res = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(futureTs))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "webhook timestamp outside allowed window" });
  });

  it("handles replayed X-Webhook-Id within 10-minute replay window as idempotent no-op (200 already_processed)", async () => {
    const app = createDepositWebhookApp(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const eventId = `rotation-replay-test-${ts}`;
    const sig = computeHmacSignature(SECRET, ts, RUNBOOK_BODY);

    // First request succeeds and records the seen event
    const firstRes = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body).toEqual({ status: "received" });

    // Second request with identical event ID is recognized as duplicate from Redis cache
    const secondRes = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body).toEqual({ status: "already_processed" });
  });

  it("contract pins header schema: missing any required header returns 400", async () => {
    const app = createDepositWebhookApp(SECRET);
    const ts = Math.floor(Date.now() / 1000);
    const eventId = `rotation-test-${ts}`;
    const sig = computeHmacSignature(SECRET, ts, RUNBOOK_BODY);

    // Missing X-Webhook-Signature
    const resNoSig = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Id", eventId)
      .send(RUNBOOK_BODY);
    expect(resNoSig.status).toBe(400);
    expect(resNoSig.body).toEqual({ error: "missing webhook headers" });

    // Missing X-Webhook-Timestamp
    const resNoTs = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Id", eventId)
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);
    expect(resNoTs.status).toBe(400);
    expect(resNoTs.body).toEqual({ error: "missing webhook headers" });

    // Missing X-Webhook-Id
    const resNoId = await request(app)
      .post("/webhooks/stellar/deposit")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Timestamp", String(ts))
      .set("X-Webhook-Signature", sig)
      .send(RUNBOOK_BODY);
    expect(resNoId.status).toBe(400);
    expect(resNoId.body).toEqual({ error: "missing webhook headers" });
  });
});
