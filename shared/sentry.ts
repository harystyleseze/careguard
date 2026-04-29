/**
 * Centralized Sentry init for the Express servers.
 *
 * - Disabled by default (no DSN -> no-op middleware).
 * - Enabled when SENTRY_DSN is set; opt-in for dev via SENTRY_ENABLE_DEV=1.
 * - Uses dynamic import so the dependency is optional at runtime: if
 *   @sentry/node isn't installed, init silently no-ops instead of crashing.
 * - All payloads pass through redact() before being sent.
 *
 * Usage:
 *   const sentry = await initSentry({ service: "agent" });
 *   app.use(sentry.requestHandler());
 *   // ...routes...
 *   app.use(sentry.errorHandler());
 */

import "dotenv/config";
import type { Application, RequestHandler, ErrorRequestHandler } from "express";
import { redact } from "./redact.ts";

export interface SentryHandle {
  enabled: boolean;
  requestHandler(): RequestHandler;
  errorHandler(): ErrorRequestHandler;
  captureException(err: unknown): void;
}

const NOOP_REQUEST: RequestHandler = (_req, _res, next) => next();
const NOOP_ERROR: ErrorRequestHandler = (err, _req, _res, next) => next(err);
const NOOP: SentryHandle = {
  enabled: false,
  requestHandler: () => NOOP_REQUEST,
  errorHandler: () => NOOP_ERROR,
  captureException: () => {},
};

function shouldEnable(): boolean {
  if (!process.env.SENTRY_DSN) return false;
  const env = process.env.NODE_ENV || "development";
  if (env === "development" && process.env.SENTRY_ENABLE_DEV !== "1") return false;
  return true;
}

export async function initSentry(opts: { service: string }): Promise<SentryHandle> {
  if (!shouldEnable()) return NOOP;

  let Sentry: any;
  try {
    // Dynamic import keeps the dependency optional. If it's not installed,
    // we degrade gracefully instead of crashing the server.
    Sentry = await import("@sentry/node");
  } catch {
    console.warn("  ⚠ Sentry: SENTRY_DSN set but @sentry/node not installed — skipping");
    return NOOP;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
    serverName: opts.service,
    initialScope: { tags: { service: opts.service } },
    beforeSend(event: any, hint: any) {
      try {
        if (event.request) event.request = redact(event.request);
        if (event.extra) event.extra = redact(event.extra);
        if (event.contexts) event.contexts = redact(event.contexts);
        if (event.user) event.user = redact(event.user);
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map((b: any) => ({
            ...b,
            data: b.data ? redact(b.data) : b.data,
            message: b.message ? redact(b.message) : b.message,
          }));
        }
        if (event.message) event.message = redact(event.message);
      } catch {
        // never let redaction throw — drop the event rather than crash
        return null;
      }
      return event;
    },
  });

  // Express integration shape varies across @sentry/node versions: prefer the
  // dedicated handlers when available, fall back to a manual error path.
  const requestHandler: RequestHandler =
    typeof Sentry.Handlers?.requestHandler === "function"
      ? Sentry.Handlers.requestHandler()
      : NOOP_REQUEST;

  const errorHandler: ErrorRequestHandler =
    typeof Sentry.Handlers?.errorHandler === "function"
      ? Sentry.Handlers.errorHandler({
          shouldHandleError: (err: any) => {
            const status = err?.status || err?.statusCode || 500;
            return status >= 500;
          },
        })
      : ((err: any, _req, _res, next) => {
          try {
            Sentry.captureException(err);
          } catch {}
          next(err);
        });

  console.log(`  ✓ Sentry initialized for ${opts.service}`);

  return {
    enabled: true,
    requestHandler: () => requestHandler,
    errorHandler: () => errorHandler,
    captureException: (err: unknown) => {
      try {
        Sentry.captureException(err);
      } catch {}
    },
  };
}

/**
 * Convenience: install both request and error handlers around a router.
 * Call this BEFORE registering routes; it returns a function to call AFTER
 * routes are registered, which installs the error handler.
 */
export function attachSentry(app: Application, sentry: SentryHandle): () => void {
  app.use(sentry.requestHandler());
  return () => app.use(sentry.errorHandler());
}
