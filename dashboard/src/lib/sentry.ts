/**
 * Lazy, env-gated Sentry wrapper for the dashboard.
 *
 * Disabled by default. Enabled when NEXT_PUBLIC_SENTRY_DSN is set.
 * Loaded dynamically so the bundle does not pull in the SDK when disabled,
 * and so a missing dependency never crashes the app.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

let cached: any = null;
let inited = false;

async function load(): Promise<any | null> {
  if (!DSN) return null;
  if (cached) return cached;
  try {
    cached = await import("@sentry/nextjs");
    return cached;
  } catch {
    return null;
  }
}

export async function captureException(err: unknown, context?: Record<string, unknown>): Promise<void> {
  const Sentry = await load();
  if (!Sentry) {
    if (typeof console !== "undefined") console.error(err, context);
    return;
  }
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // never let Sentry errors propagate
  }
}

export function isEnabled(): boolean {
  return !!DSN;
}

export function markInited(): void {
  inited = true;
}

export function alreadyInited(): boolean {
  return inited;
}
