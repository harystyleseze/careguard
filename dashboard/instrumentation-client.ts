/**
 * Next.js client instrumentation. Loaded by Next at the top of the client
 * bundle. The actual init is in sentry.client.config.ts and is a no-op when
 * NEXT_PUBLIC_SENTRY_DSN is unset.
 */

import "./sentry.client.config";
