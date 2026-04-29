/**
 * Edge runtime Sentry init for Next.js. No-ops if SENTRY_DSN is unset
 * or @sentry/nextjs is not installed.
 */

export {};

if (process.env.SENTRY_DSN) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
      });
    })
    .catch(() => {});
}
