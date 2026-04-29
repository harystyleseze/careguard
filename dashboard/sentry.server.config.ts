/**
 * Server-side (Node runtime) Sentry init for Next.js.
 * No-ops if SENTRY_DSN is unset or @sentry/nextjs is not installed.
 */

export {};

if (process.env.SENTRY_DSN) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        release: process.env.SENTRY_RELEASE,
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
        beforeSend(event) {
          if (event.request?.data && typeof event.request.data === "object") {
            const data = event.request.data as Record<string, unknown>;
            if ("task" in data) data.task = "[REDACTED]";
          }
          return event;
        },
      });
    })
    .catch(() => {});
}
