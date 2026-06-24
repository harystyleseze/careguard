/**
 * HTTP request logging middleware (pino).
 *
 * Logs one structured line per request on response finish:
 *   { method, path, status, duration_ms, requestId, agentRunId }
 *
 * Level routing:
 *   - 5xx                            → error
 *   - 4xx on sensitive API paths     → warn
 *   - everything else                → info
 */

import type { RequestHandler } from "express";
import { log } from "./logger.ts";

const SENSITIVE_PATHS = new Set(["/agent/run", "/bill/audit", "/pharmacy/order"]);

export function requestLoggerMiddleware(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();

    res.on("finish", () => {
      const duration_ms = Date.now() - start;
      const { method } = req;
      const path = req.path || req.url;
      const status = res.statusCode;

      const data = { method, path, status, duration_ms };

      if (status >= 500) {
        log.error(data, "http");
      } else if (status >= 400 && SENSITIVE_PATHS.has(path)) {
        log.warn(data, "http");
      } else {
        log.info(data, "http");
      }
    });

    next();
  };
}
