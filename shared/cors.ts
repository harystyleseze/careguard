import cors from "cors";
import type { RequestHandler } from "express";
import { logger } from "./logger.ts";

export function createCorsMiddleware(): RequestHandler {
  const allowed = parseAllowedOrigins();
  logger.info(`CORS: allowlist = [${allowed.join(", ")}]`);

  return cors({
    origin(requestOrigin, callback) {
      // Server-to-server requests with no Origin header — allow
      if (!requestOrigin) return callback(null, true);
      if (allowed.includes(requestOrigin)) return callback(null, true);
      // Not in allowlist — omit Access-Control-Allow-Origin so browser blocks it
      callback(null, false);
    },
    credentials: true,
  }) as RequestHandler;
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? "";
  const fromEnv = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  // Defaults: dashboard local dev + configured prod URLs
  const defaults = ["http://localhost:3000"];
  if (process.env.PROD_URL) defaults.push(process.env.PROD_URL);
  if (process.env.DASHBOARD_URL) defaults.push(process.env.DASHBOARD_URL);
  return defaults;
}
