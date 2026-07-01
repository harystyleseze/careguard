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

const createLimiter = (policyName: string, maxRequests: number, windowMs: number = 60 * 1000) => {
  if (process.env.NODE_ENV === "test") {
    return (req: any, res: any, next: any) => next();
  }
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      rateLimitHitsTotal.inc({ policy: policyName });
      res.status(options.statusCode).set("Retry-After", String(Math.ceil(options.windowMs / 1000))).send(options.message);
    },
  });
};

// Per-route rate limiters with independent token buckets so a spike on one
// route (e.g. bill audits) cannot starve another (e.g. agent runs).
// Limits are intentionally conservative — adjust via env vars once baseline
// traffic is measured. See docs/adr/unified-vs-split-server.md for context.
export const perRouteLimiters = {
  // Agent run is CPU+LLM bound; strict limit prevents queue starvation
  agentRun: createLimiter("agent_run", parseInt(process.env.RATE_LIMIT_AGENT_RUN || "5")),
  // Bill audit is I/O light but payload-heavy; separate bucket
  billAudit: createLimiter("bill_audit", parseInt(process.env.RATE_LIMIT_BILL_AUDIT || "20")),
  // Pharmacy compare is cheap — allow more headroom
  pharmacyCompare: createLimiter("pharmacy_compare", parseInt(process.env.RATE_LIMIT_PHARMACY_COMPARE || "30")),
  // Drug interactions is lightweight
  drugInteractions: createLimiter("drug_interactions", parseInt(process.env.RATE_LIMIT_DRUG_INTERACTIONS || "30")),
  // Pharmacy orders involve on-chain payment; keep tight
  pharmacyOrder: createLimiter("pharmacy_order", parseInt(process.env.RATE_LIMIT_PHARMACY_ORDER || "10")),
};

export const rateLimiters = {
  agent: createLimiter("agent", 5),
  x402: createLimiter("x402", 30),
  health: rateLimit({
    windowMs: 60 * 1000,
    max: 0,
    handler: (req, res, next) => next(),
  }) as RateLimitRequestHandler,
  default: createLimiter("default", 60),
};

// Override health limiter to be truly unlimited pass-through
rateLimiters.health = ((req: Request, res: Response, next: NextFunction) => next()) as unknown as RateLimitRequestHandler;

/**
 * Middleware that increments/decrements the route_concurrent_requests gauge
 * so operators can detect noisy-neighbor patterns in Prometheus/Grafana.
 */
export function concurrentRequestsMiddleware(route: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    routeConcurrentRequests.inc({ route });
    res.on("finish", () => routeConcurrentRequests.dec({ route }));
    res.on("close", () => routeConcurrentRequests.dec({ route }));
    next();
  };
}
