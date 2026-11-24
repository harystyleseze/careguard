import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { Counter, Gauge } from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const rateLimitHitsTotal = new Counter({
  name: "ratelimit_hits_total",
  help: "Total number of requests that exceeded the rate limit",
  labelNames: ["policy"],
});

// Tracks concurrent in-flight requests per route for noisy-neighbor detection (issue #237)
export const routeConcurrentRequests = new Gauge({
  name: "route_concurrent_requests",
  help: "Number of in-flight requests currently being processed per route",
  labelNames: ["route"],
});

export const DEFAULT_WINDOW_MS = 60 * 1000;

/**
 * Parse an env-configured request limit.
 *
 * A malformed value must never disable limiting: `parseInt` alone turns "abc"
 * into NaN and "-5" into a negative, either of which express-rate-limit reads as
 * "no limit". Anything that is not a positive integer falls back to the
 * documented default instead (issue #799).
 */
export function parseLimitEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Build a rate limiter for one policy.
 *
 * Exported so tests can mount a real limiter — the module-level policies below
 * deliberately no-op under NODE_ENV=test so unrelated suites are not throttled.
 */
export function createRateLimiter(
  policyName: string,
  maxRequests: number,
  windowMs: number = DEFAULT_WINDOW_MS,
  customMessage?: any,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: customMessage || { error: `Too many requests for ${policyName}, please try again later.` },
    handler: (_req, res, _next, options) => {
      rateLimitHitsTotal.inc({ policy: policyName });
      // Always terminate the chain with a response — never fall through without
      // one, which would leave the request hanging until the client gives up.
      const payload =
        typeof options.message === "object" && options.message !== null
          ? options.message
          : { error: String(options.message) };
      res
        .status(options.statusCode)
        .set("Retry-After", String(Math.ceil(options.windowMs / 1000)))
        .json(payload);
    },
  });
}

const createLimiter = (
  policyName: string,
  maxRequests: number,
  windowMs: number = DEFAULT_WINDOW_MS,
) => {
  if (process.env.NODE_ENV === "test") {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }
  return createRateLimiter(policyName, maxRequests, windowMs);
};

// Documented defaults, used whenever the matching env var is unset or invalid.
export const RATE_LIMIT_DEFAULTS = {
  agentRun: 5,
  billAudit: 20,
  pharmacyCompare: 30,
  drugInteractions: 30,
  pharmacyOrder: 10,
} as const;

// Per-route rate limiters with independent token buckets so a spike on one
// route (e.g. bill audits) cannot starve another (e.g. agent runs).
// Limits are intentionally conservative — adjust via env vars once baseline
// traffic is measured. See docs/adr/unified-vs-split-server.md for context.
export const perRouteLimiters = {
  // Agent run is CPU+LLM bound; strict limit prevents queue starvation
  agentRun: createLimiter(
    "agent_run",
    parseLimitEnv(process.env.RATE_LIMIT_AGENT_RUN, RATE_LIMIT_DEFAULTS.agentRun),
  ),
  // Bill audit is I/O light but payload-heavy; separate bucket
  billAudit: createLimiter(
    "bill_audit",
    parseLimitEnv(process.env.RATE_LIMIT_BILL_AUDIT, RATE_LIMIT_DEFAULTS.billAudit),
  ),
  // Pharmacy compare is cheap — allow more headroom
  pharmacyCompare: createLimiter(
    "pharmacy_compare",
    parseLimitEnv(
      process.env.RATE_LIMIT_PHARMACY_COMPARE,
      RATE_LIMIT_DEFAULTS.pharmacyCompare,
    ),
  ),
  // Drug interactions is lightweight
  drugInteractions: createLimiter(
    "drug_interactions",
    parseLimitEnv(
      process.env.RATE_LIMIT_DRUG_INTERACTIONS,
      RATE_LIMIT_DEFAULTS.drugInteractions,
    ),
  ),
  // Pharmacy orders involve on-chain payment; keep tight
  pharmacyOrder: createLimiter(
    "pharmacy_order",
    parseLimitEnv(
      process.env.RATE_LIMIT_PHARMACY_ORDER,
      RATE_LIMIT_DEFAULTS.pharmacyOrder,
    ),
  ),
};

export const rateLimiters = {
  agent: createLimiter("agent", 5),
  x402: createLimiter("x402", 30),
  health: rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    max: 0,
    handler: (_req, _res, next) => next(),
  }) as RateLimitRequestHandler,
  default: createLimiter("default", 60),
};

// Override health limiter to be truly unlimited pass-through
rateLimiters.health = ((req: Request, res: Response, next: NextFunction) => next()) as unknown as RateLimitRequestHandler;

/**
 * Middleware that increments/decrements the route_concurrent_requests gauge
 * so operators can detect noisy-neighbor patterns in Prometheus/Grafana.
 *
 * Express fires both `finish` and `close` for most requests, so the decrement is
 * latched: without it the gauge drifts negative and the "in-flight" reading
 * becomes meaningless (issue #799).
 */
export function concurrentRequestsMiddleware(route: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    routeConcurrentRequests.inc({ route });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      routeConcurrentRequests.dec({ route });
    };

    res.on("finish", release);
    res.on("close", release);
    next();
  };
}
