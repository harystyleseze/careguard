/**
 * Client-side Sentry init. No-ops if NEXT_PUBLIC_SENTRY_DSN is unset
 * or @sentry/nextjs is not installed.
 */

export {};

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  // Dynamic import keeps the SDK out of the client bundle when disabled.
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        tracesSampleRate: parseFloat(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0"),
        beforeSend(event) {
          // Drop the agent task value if it leaks into client error context.
          if (event.request?.data && typeof event.request.data === "object") {
            const data = event.request.data as Record<string, unknown>;
            if ("task" in data) data.task = "[REDACTED]";
          }
          return event;
        },
      });
    })
    .catch(() => {
      // SDK not installed — silently no-op
    });
}
