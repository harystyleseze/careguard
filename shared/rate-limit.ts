import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import { Counter } from "prom-client";
import { redisClient } from "./redis.js"; // Assuming a redis client is exported from shared/redis.ts

export const rateLimitHitsTotal = new Counter({
  name: "ratelimit_hits_total",
  help: "Total number of requests that exceeded the rate limit",
  labelNames: ["policy"],
});

const createStore = () => {
  // Use Redis if available and connected
  if (redisClient && redisClient.status === "ready") {
    return new RedisStore({
      // @ts-expect-error - ioredis types sometimes clash with rate-limit-redis
      sendCommand: (...args: string[]) => redisClient.call(...args),
    });
  }
  // Fallback to MemoryStore (default in express-rate-limit)
  return undefined;
};

const createLimiter = (policyName: string, maxRequests: number, windowMs: number = 60 * 1000) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    store: createStore(),
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
    max: 0, // 0 max with standard configuration often means blocked, but in express-rate-limit `max: 0` means 0 allowed. To make it unlimited, we just return a pass-through middleware
    handler: (req, res, next) => next(),
  }),
  default: createLimiter("default", 60),
};

// Override health limiter to be truly unlimited pass-through
rateLimiters.health = (req, res, next) => next();
