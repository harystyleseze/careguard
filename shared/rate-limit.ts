import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { Counter } from "prom-client";
import type { Request, Response, NextFunction } from "express";

export const rateLimitHitsTotal = new Counter({
  name: "ratelimit_hits_total",
  help: "Total number of requests that exceeded the rate limit",
  labelNames: ["policy"],
});

const createLimiter = (policyName: string, maxRequests: number, windowMs: number = 60 * 1000) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (req, res, next, options) => {
      rateLimitHitsTotal.inc({ policy: policyName });
      res.status(options.statusCode).set("Retry-After", String(Math.ceil(options.windowMs / 1000))).send(options.message);
    },
  });
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
