import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Constant-time comparison to prevent timing attacks.
 * SHA-256 hashes the inputs first so that they are compared at a fixed length (32 bytes).
 */
export function safeCompare(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * Middleware to require AGENT_API_KEY on /agent/* routes.
 * Checks the Authorization header (Bearer token) or a query parameter (for SSE).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = process.env.AGENT_API_KEY;

  if (!apiKey) {
    if (process.env.NODE_ENV === "production") {
      res.status(401)
        .setHeader("WWW-Authenticate", "Bearer")
        .json({ error: "Unauthorized: AGENT_API_KEY is not configured" });
      return;
    }
    next();
    return;
  }

  const auth = req.headers.authorization;
  let token: string | undefined;

  if (auth?.startsWith("Bearer ")) {
    token = auth.slice("Bearer ".length);
  } else if (req.query.apiKey && typeof req.query.apiKey === "string") {
    token = req.query.apiKey;
  }

  if (!token || !safeCompare(token, apiKey)) {
    res.status(401)
      .setHeader("WWW-Authenticate", "Bearer")
      .json({ error: "Unauthorized: Invalid AGENT_API_KEY" });
    return;
  }

  next();
}
