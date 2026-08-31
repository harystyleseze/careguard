/**
 * Centralized Sentry init for the Express servers.
 *
 * - Disabled by default (no DSN -> no-op middleware).
 * - Enabled when SENTRY_DSN is set; opt-in for dev via SENTRY_ENABLE_DEV=1.
 * - Uses dynamic import so the dependency is optional at runtime: if
 *   @sentry/node isn't installed, init silently no-ops instead of crashing.
 * - All payloads pass through redact() before being sent.
 * - Aligned on @sentry/node ^10.62.0 to match dashboard @sentry/nextjs ^10.62.0 (v10 line).
 *   v8+ removed Sentry.Handlers.* in favor of OpenTelemetry auto-instrumentation.
 *   v10 keeps that model (OTEL v2) — see https://docs.sentry.io/platforms/javascript/guides/express/
 *   For error monitoring without tracing, no requestHandler middleware is needed; the SDK instruments
 *   http/express automatically when Sentry.init() runs first. We keep a backwards-compatible
 *   requestHandler/errorHandler surface and fall back to manual captureException for 5xx when
 *   Handlers is absent. When Sentry.setupExpressErrorHandler(app) is available (v8+/v10), it is
 *   the documented way to enrich error events with route context — attachSentry will prefer it
 *   when present, otherwise the 5xx-only manual handler still ensures error capture in staging.
 *
 * Usage:
 *   const sentry = await initSentry({ service: "agent" });
 *   app.use(sentry.requestHandler());
 *   // ...routes...
 *   app.use(sentry.errorHandler());
 *   // or:
 *   const done = attachSentry(app, sentry); // before routes
 *   // ...routes...
 *   done(); // after routes
 */

import "dotenv/config";
import type { Application, RequestHandler, ErrorRequestHandler } from "express";
import { redact } from "./redact.ts";
import { logger } from "./logger.ts";

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

// Cached Sentry module for attachSentry's v10 setupExpressErrorHandler path.
let _cachedSentry: any = null;

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
    _cachedSentry = Sentry;
  } catch {
    logger.warn("Sentry: SENTRY_DSN set but @sentry/node not installed — skipping");
    return NOOP;
  }

  // Build init options compatible with both v8 and v10.
  // v10 (OTEL v2) keeps the same top-level keys (dsn, environment, release,
  // tracesSampleRate, serverName, initialScope, beforeSend) but integrations
  // have moved from class-based to function-based and Handlers.* is gone.
  const initOptions: any = {
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
  };

  // v8+/v10: Handlers.* removed — http/express are auto-instrumented via OTEL
  // when Sentry.init() runs before other imports. Add function-based integrations
  // only when the SDK exposes them, so v8 and v10 both work without warnings.
  try {
    const integrations: any[] = [];
    // requestDataIntegration replaces Handlers.requestHandler user/request extraction
    if (typeof Sentry.requestDataIntegration === "function") {
      integrations.push(Sentry.requestDataIntegration());
    } else if (typeof Sentry.httpIntegration === "function" && !Sentry.Handlers) {
      integrations.push(Sentry.httpIntegration());
    }
    // expressIntegration adds route transaction names when tracing is enabled
    if (typeof Sentry.expressIntegration === "function" && !Sentry.Handlers) {
      integrations.push(Sentry.expressIntegration());
    }
    if (integrations.length > 0) {
      initOptions.integrations = integrations;
    }
  } catch {
    // integration setup is best-effort; never block init
  }

  Sentry.init(initOptions);

  // Express integration shape varies across @sentry/node versions: prefer the
  // dedicated handlers when available (v7), otherwise no-op/fallback for v8+/v10.
  // In v10, Sentry.setupExpressErrorHandler(app) is the documented error handler
  // (call after routes) — we provide a 5xx-only fallback so error capture still
  // works when that API is not used via attachSentry.
  const requestHandler: RequestHandler =
    typeof Sentry.Handlers?.requestHandler === "function"
      ? Sentry.Handlers.requestHandler()
      : NOOP_REQUEST; // v8+/v10: OTEL auto-instruments, no middleware needed

  const errorHandler: ErrorRequestHandler =
    typeof Sentry.Handlers?.errorHandler === "function"
      ? Sentry.Handlers.errorHandler({
          shouldHandleError: (err: any) => {
            const status = err?.status || err?.statusCode || 500;
            return status >= 500;
          },
        })
      : ((err: any, _req, _res, next) => {
          const status = err?.status || err?.statusCode || 500;
          if (status >= 500) {
            try {
              Sentry.captureException(err);
            } catch {}
          }
          next(err);
        });

  logger.info({ service: opts.service }, "Sentry initialized");

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
 *
 * On Sentry v10 (and v8), the SDK auto-instruments Express via OTEL, so
 * requestHandler is a no-op. For rich error context (route name, trace),
 * the documented API is Sentry.setupExpressErrorHandler(app) called after
 * routes — we try that first when the cached SDK exposes it, and fall back
 * to the 5xx-only captureException handler otherwise.
 */
export function attachSentry(app: Application, sentry: SentryHandle): () => void {
  app.use(sentry.requestHandler());
  return () => {
    // Prefer the v8+/v10 helper when available for full route/trace context.
    const Sany: any = _cachedSentry;
    if (Sany && typeof Sany.setupExpressErrorHandler === "function") {
      try {
        Sany.setupExpressErrorHandler(app);
        return;
      } catch {
        // fall through to generic handler
      }
    }
    app.use(sentry.errorHandler());
  };
}
