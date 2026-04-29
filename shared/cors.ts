import cors from "cors";
import type { RequestHandler } from "express";

export function createCorsMiddleware(): RequestHandler {
  const nodeEnv = process.env.NODE_ENV ?? "development";

  if (nodeEnv !== "production") {
    console.warn(
      "⚠ CORS: running in non-production mode — all origins allowed (wildcard). " +
        "Set NODE_ENV=production and ALLOWED_ORIGINS to restrict access.",
    );
    return cors() as RequestHandler;
  }

  const allowed = parseAllowedOrigins();
  console.log(`✓ CORS: allowlist = [${allowed.join(", ")}]`);

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

  // Defaults: dashboard local dev + configured prod URL
  const defaults = ["http://localhost:3000"];
  if (process.env.PROD_URL) defaults.push(process.env.PROD_URL);
  return defaults;
}
