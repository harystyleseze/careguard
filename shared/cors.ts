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
  const fromAllowlist = parseOriginList(process.env.ALLOWED_ORIGINS);
  if (fromAllowlist.length > 0) return fromAllowlist;

  const fromDashboardOrigin = parseOriginList(process.env.DASHBOARD_ORIGIN);
  if (fromDashboardOrigin.length > 0) return fromDashboardOrigin;

  // Defaults: dashboard local dev + configured prod URLs
  const defaults = ["http://localhost:3000"];
  if (process.env.PROD_URL) defaults.push(process.env.PROD_URL);
  if (process.env.DASHBOARD_URL) defaults.push(process.env.DASHBOARD_URL);
  return validateNoWildcard(defaults);
}

function parseOriginList(value?: string): string[] {
  return validateNoWildcard(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function validateNoWildcard(origins: string[]): string[] {
  if (origins.includes("*")) {
    throw new Error(
      "CORS wildcard origin '*' is not allowed. Set DASHBOARD_ORIGIN or ALLOWED_ORIGINS to explicit origins.",
    );
  }
  return origins;
}
