/**
 * Single source of truth for the agent API base URL (#222).
 *
 * Behaviour:
 *  - Dev (NODE_ENV !== 'production'):
 *      Falls back to http://localhost:3004 but logs a one-time console.warn
 *      so developers notice the missing env var without breaking the DX.
 *  - Production (NODE_ENV === 'production'):
 *      Returns null when NEXT_PUBLIC_API_URL is unset. The dashboard's root
 *      page checks for null and renders a <ConfigErrorPage> instead of the
 *      normal UI, giving operators a clear error rather than a confusing
 *      connection failure to localhost.
 */

const RAW_URL = process.env.NEXT_PUBLIC_API_URL;
const IS_PROD = process.env.NODE_ENV === 'production';
const FALLBACK = 'http://localhost:3004';

function resolveAgentUrl(): string | null {
  if (RAW_URL) return RAW_URL;

  if (IS_PROD) {
    // In production a missing env var is a misconfiguration — signal null so
    // the UI can render an informative error page rather than silently
    // connecting to localhost (which will fail in non-local deployments).
    return null;
  }

  // Dev: warn once at module-load time and fall back so hot-reload still works.
  console.warn(
    '[CareGuard] NEXT_PUBLIC_API_URL is not set. ' +
    `Falling back to ${FALLBACK}. ` +
    'Set this variable in your .env.local file (see dashboard/.env.example).',
  );
  return FALLBACK;
}

/**
 * The resolved agent API URL.
 *
 * - Always a string in dev (with a console.warn if the env var is missing).
 * - null in production when NEXT_PUBLIC_API_URL is not set — callers should
 *   check for null and render a configuration error page.
 */
export const AGENT_URL: string | null = resolveAgentUrl();
