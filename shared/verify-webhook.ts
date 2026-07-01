/**
 * HMAC webhook signature verification middleware with replay protection.
 *
 * Expected headers on every inbound webhook request:
 *   X-Webhook-Signature: sha256=<hex-hmac-sha256(secret, "<timestamp>.<raw-body>")>
 *   X-Webhook-Timestamp: <unix-seconds>
 *   X-Webhook-Id:        <unique-event-id>
 *
 * Rejection rules:
 *   - Missing/malformed headers → 400
 *   - Signature mismatch        → 400
 *   - Timestamp outside ±5 min  → 400
 *   - Duplicate X-Webhook-Id    → 200 no-op (idempotent)
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as cache from "./redis.ts";
import { logger } from "./logger.ts";

const TOLERANCE_MS = 5 * 60 * 1000;       // 5 minutes
const REPLAY_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const REPLAY_KEY_PREFIX = "webhook:seen:";

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

function parseSignature(header: string): string | null {
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  return match ? match[1].toLowerCase() : null;
}

export interface VerifyWebhookOptions {
  /** HMAC secret. Defaults to WEBHOOK_SECRET env var. */
  secret?: string;
  /** Override tolerance window in ms (default 5 min). */
  toleranceMs?: number;
  /** Override replay window TTL in ms (default 10 min). */
  replayWindowMs?: number;
}

/**
 * Returns Express middleware that verifies Stellar webhook authenticity.
 *
 * Mount it before any body-consuming middleware on the webhook route so that
 * `req.body` is still the raw Buffer when the middleware runs — or pass
 * express.raw() first and this middleware second.
 */
export function verifyWebhook(opts: VerifyWebhookOptions = {}): RequestHandler {
  const secret =
    opts.secret ?? process.env.WEBHOOK_SECRET ?? "";
  const toleranceMs = opts.toleranceMs ?? TOLERANCE_MS;
  const replayWindowMs = opts.replayWindowMs ?? REPLAY_WINDOW_MS;

  if (!secret) {
    logger.warn(
      "verifyWebhook: WEBHOOK_SECRET is not set — all webhook requests will be rejected",
    );
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const sigHeader = req.headers["x-webhook-signature"] as string | undefined;
    const tsHeader = req.headers["x-webhook-timestamp"] as string | undefined;
    const idHeader = req.headers["x-webhook-id"] as string | undefined;

    // ── Header presence ───────────────────────────────────────────────────────
    if (!sigHeader || !tsHeader || !idHeader) {
      logger.warn({ path: req.path }, "webhook: missing required headers");
      res.status(400).json({ error: "missing webhook headers" });
      return;
    }

    // ── Timestamp window ──────────────────────────────────────────────────────
    const tsSeconds = parseInt(tsHeader, 10);
    if (!Number.isFinite(tsSeconds)) {
      res.status(400).json({ error: "invalid X-Webhook-Timestamp" });
      return;
    }
    const ageDeltaMs = Math.abs(Date.now() - tsSeconds * 1000);
    if (ageDeltaMs > toleranceMs) {
      logger.warn({ ageDeltaMs, path: req.path }, "webhook: stale timestamp");
      res.status(400).json({ error: "webhook timestamp outside allowed window" });
      return;
    }

    // ── Signature verification ────────────────────────────────────────────────
    const providedHex = parseSignature(sigHeader);
    if (!providedHex) {
      res.status(400).json({ error: "malformed X-Webhook-Signature" });
      return;
    }

    // Raw body: express.raw() stores it as Buffer on req.body; JSON middleware
    // leaves it as a parsed object. We serialise consistently either way.
    const rawBody: string =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body ?? "");

    if (!secret) {
      res.status(400).json({ error: "webhook secret not configured" });
      return;
    }

    const expected = sign(secret, tsHeader, rawBody);

    let provided: Buffer;
    let expectedBuf: Buffer;
    try {
      provided = Buffer.from(providedHex, "hex");
      expectedBuf = Buffer.from(expected, "hex");
    } catch {
      res.status(400).json({ error: "malformed X-Webhook-Signature" });
      return;
    }

    if (
      provided.length !== expectedBuf.length ||
      !timingSafeEqual(provided, expectedBuf)
    ) {
      logger.warn({ path: req.path }, "webhook: signature mismatch");
      res.status(400).json({ error: "invalid webhook signature" });
      return;
    }

    // ── Replay protection ─────────────────────────────────────────────────────
    const replayKey = `${REPLAY_KEY_PREFIX}${idHeader}`;
    const seen = await cache.get(replayKey);
    if (seen !== null) {
      logger.info(
        { webhookId: idHeader, path: req.path },
        "webhook: duplicate event — returning 200 no-op",
      );
      res.status(200).json({ status: "already_processed" });
      return;
    }
    await cache.set(replayKey, "1", replayWindowMs);

    next();
  };
}

/** Computes the expected X-Webhook-Signature value for a given payload. */
export function computeWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return `sha256=${sign(secret, timestamp, body)}`;
}
