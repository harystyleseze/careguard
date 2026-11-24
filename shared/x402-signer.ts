/**
 * x402 Signer Configuration
 *
 * Handles signing-side x402 operations for outbound payments (agent making payments
 * to APIs). Extracted from x402-middleware.ts to decouple signing concerns from
 * verification middleware used by service endpoints.
 *
 * Used by: agent/tools.ts (getX402Fetch for API payments)
 *
 * Protocol version changes must stay synchronized with x402-verify-middleware.ts.
 */

import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createEd25519Signer, ExactStellarScheme } from "@x402/stellar";
import { resolveStellarNetwork } from "./stellar-network.ts";
import { isMockNetwork } from "./network-mode.ts";
import { logger } from "./logger.ts";

const STELLAR_CONFIG = resolveStellarNetwork();
const x402SchemeId =
  `stellar:${STELLAR_CONFIG.networkType}` as `${string}:${string}`;

export const X402_SIGNER_TTL_MS = 60_000;

let _x402Fetch: typeof fetch | null = null;
let _x402FetchCreatedAt = 0;

/**
 * Get a fetch function wrapped with x402 payment signing capability.
 * Re-reads AGENT_SECRET_KEY on a 60s TTL so the key can be rotated without
 * a full process restart. SIGHUP triggers immediate cache invalidation.
 *
 * @returns Fetch function with automatic x402 payment signing
 */
export function getX402Fetch(): typeof fetch {
  if (isMockNetwork()) return fetch;

  const now = Date.now();
  if (!_x402Fetch || now - _x402FetchCreatedAt > X402_SIGNER_TTL_MS) {
    const key = process.env.AGENT_SECRET_KEY;
    if (!key) throw new Error("AGENT_SECRET_KEY required for x402 signing");

    _x402Fetch = wrapFetchWithPayment(
      fetch,
      new x402Client().register(
        x402SchemeId,
        new ExactStellarScheme(createEd25519Signer(key, x402SchemeId)),
      ),
    );
    _x402FetchCreatedAt = now;
  }

  return _x402Fetch;
}

/**
 * Invalidate the x402 fetch cache (called on SIGHUP for zero-downtime key rotation).
 */
export function invalidateX402SignerCache(): void {
  _x402Fetch = null;
  _x402FetchCreatedAt = 0;
  logger.info("[x402-signer] Cache invalidated, will reload on next call");
}

process.on("SIGHUP", invalidateX402SignerCache);

export { x402SchemeId, X402_SIGNER_TTL_MS as SIGNER_TTL_MS };
