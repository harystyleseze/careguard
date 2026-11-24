/**
 * Device token store for mobile push notifications.
 *
 * Tokens are persisted in a JSONL file (one JSON object per line) so the
 * store survives restarts and can be inspected with standard tools.
 * Each caregiver may have multiple device tokens (phone + tablet, etc.).
 *
 * Endpoints are exposed via `pushTokenRouter`:
 *   POST   /agent/push-tokens       — register a new device token
 *   DELETE /agent/push-tokens/:token — revoke (remove) a device token
 *   GET    /agent/push-tokens        — list all registered tokens
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { Router, Request, Response } from "express";
import { fileURLToPath } from "url";
import { z } from "zod";
import { logger } from "./logger.ts";

// ── Storage ──────────────────────────────────────────────────────────────────

function getTokensFilePath(): string {
  const dataDir =
    process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return `${dataDir}/push-tokens.jsonl`;
}

export interface PushTokenEntry {
  caregiverId: string;
  token: string;
  platform: "ios" | "android" | "web";
  registeredAt: string;
}

function readAllTokens(): PushTokenEntry[] {
  const file = getTokensFilePath();
  if (!existsSync(file)) return [];

  const content = readFileSync(file, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const entries: PushTokenEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

function rewriteTokens(entries: PushTokenEntry[]): void {
  const file = getTokensFilePath();
  const content = entries.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(file, content.length > 0 ? content + "\n" : "", "utf-8");
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register (or refresh) a device token for a caregiver.
 * If the token already exists it is updated in-place.
 */
export function registerPushToken(
  caregiverId: string,
  token: string,
  platform: "ios" | "android" | "web" = "android",
): PushTokenEntry {
  const entries = readAllTokens();
  const existingIdx = entries.findIndex((e) => e.token === token);

  const entry: PushTokenEntry = {
    caregiverId,
    token,
    platform,
    registeredAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    entries[existingIdx] = entry;
  } else {
    entries.push(entry);
  }

  rewriteTokens(entries);
  logger.info({ caregiverId, platform }, "[push-tokens] registered device token");
  return entry;
}

/**
 * Revoke (remove) a device token — called when a caregiver logs out.
 * Returns true if the token was found and removed.
 */
export function revokePushToken(token: string): boolean {
  const entries = readAllTokens();
  const filtered = entries.filter((e) => e.token !== token);

  if (filtered.length === entries.length) {
    // Token not found
    return false;
  }

  rewriteTokens(filtered);
  logger.info({ token: token.slice(0, 12) + "…" }, "[push-tokens] revoked device token");
  return true;
}

/**
 * Get all device tokens for a specific caregiver.
 */
export function getPushTokens(caregiverId: string): PushTokenEntry[] {
  return readAllTokens().filter((e) => e.caregiverId === caregiverId);
}

/**
 * Get all registered device tokens (across all caregivers).
 */
export function getAllPushTokens(): PushTokenEntry[] {
  return readAllTokens();
}

// ── Express Router ───────────────────────────────────────────────────────────

const RegisterTokenSchema = z.object({
  caregiver_id: z.string().min(1),
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]).default("android"),
});

export const pushTokenRouter = Router();

/**
 * POST /agent/push-tokens — register a device token.
 * Body: { caregiver_id, token, platform }
 */
pushTokenRouter.post("/", (req: Request, res: Response) => {
  const parsed = RegisterTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      issues: parsed.error.issues,
    });
  }

  const entry = registerPushToken(
    parsed.data.caregiver_id,
    parsed.data.token,
    parsed.data.platform,
  );
  res.status(201).json({ success: true, token: entry });
});

/**
 * DELETE /agent/push-tokens/:token — revoke a device token.
 */
pushTokenRouter.delete("/:token", (req: Request, res: Response) => {
  const token = req.params.token;
  if (!token) {
    return res.status(400).json({ error: "Token parameter required" });
  }

  const removed = revokePushToken(token);
  if (!removed) {
    return res.status(404).json({ error: "Token not found" });
  }

  res.json({ success: true });
});

/**
 * GET /agent/push-tokens — list all registered tokens.
 */
pushTokenRouter.get("/", (_req: Request, res: Response) => {
  res.json({ tokens: getAllPushTokens() });
});
