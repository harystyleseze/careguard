import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * Constant-time comparison to prevent timing attacks.
 * SHA-256 hashes the inputs first so that they are compared at a fixed length (32 bytes).
 * Guarantees constant time regardless of input string lengths and never throws on length mismatch.
 */
export function safeCompare(a: string, b: string): boolean {
  const aHash = crypto.createHash("sha256").update(a).digest();
  const bHash = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(aHash, bHash);
}

/**
 * Parses HTTP cookie header into key-value pairs.
 * Handles url-encoded values and cookie values containing '=' cleanly.
 * Time complexity: O(L) where L is header string length.
 * Space complexity: O(K) where K is number of cookie pairs.
 */
export function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const trimmed = cookie.trim();
    if (!trimmed) return;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      list[trimmed] = "";
      return;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    try {
      list[key] = decodeURIComponent(val);
    } catch {
      list[key] = val;
    }
  });
  return list;
}

/**
 * Result of extracting a caregiver token from a request.
 */
export interface CaregiverAuthResult {
  token?: string;
  error?: {
    status: number;
    message: string;
  };
}

/**
 * Extracts caregiver token from Authorization header or cookie.
 * When cookie-based authentication is used, enforces constant-time CSRF validation.
 */
export function extractCaregiverToken(req: Request): CaregiverAuthResult {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return { token: auth.slice("Bearer ".length).trim() };
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["caregiver_token"];

  if (token) {
    const csrfHeaderRaw = req.headers["x-csrf-token"];
    const csrfHeader =
      typeof csrfHeaderRaw === "string"
        ? csrfHeaderRaw
        : Array.isArray(csrfHeaderRaw)
          ? csrfHeaderRaw[0]
          : undefined;
    const csrfCookie = cookies["csrf_token"];

    if (!csrfHeader || !csrfCookie || !safeCompare(csrfHeader, csrfCookie)) {
      return {
        error: {
          status: 403,
          message: "CSRF token mismatch or missing",
        },
      };
    }

    return { token };
  }

  return {};
}

/**
 * Validates caregiver token against expected token using constant-time comparison.
 */
function handleCaregiverAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  expectedToken?: string,
): void {
  const { token, error } = extractCaregiverToken(req);
  if (error) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (!token) {
    res
      .status(401)
      .setHeader("WWW-Authenticate", "Bearer")
      .json({ error: "Missing caregiver token" });
    return;
  }

  const targetToken = expectedToken ?? process.env.CAREGIVER_TOKEN ?? "";
  if (!targetToken || !safeCompare(token, targetToken)) {
    res.status(403).json({ error: "Invalid caregiver token" });
    return;
  }

  next();
}

/**
 * Middleware or middleware-factory requiring a valid caregiver token.
 * Supports:
 *   - requireCaregiverToken(req, res, next) (uses process.env.CAREGIVER_TOKEN)
 *   - requireCaregiverToken(expectedToken) (returns Express middleware)
 */
export function requireCaregiverToken(
  expectedToken?: string,
): (req: Request, res: Response, next: NextFunction) => void;
export function requireCaregiverToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void;
export function requireCaregiverToken(
  arg1?: string | Request,
  arg2?: Response,
  arg3?: NextFunction,
): any {
  if (typeof arg1 === "string" || arg1 === undefined) {
    return (req: Request, res: Response, next: NextFunction) => {
      handleCaregiverAuth(req, res, next, arg1);
    };
  }

  // Called directly as express middleware: (req, res, next)
  return handleCaregiverAuth(arg1 as Request, arg2 as Response, arg3 as NextFunction);
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
