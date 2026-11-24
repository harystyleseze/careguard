/**
 * Dynamic Stellar fee selection.
 *
 * Reads Horizon /fee_stats and targets the p90 fee charged in the
 * recent ledger history. Falls back to "100" stroops on any error.
 *
 * Supports TTL caching and in-flight request coalescing to prevent
 * rate limit exhaustion and eliminate network latency overhead under
 * concurrent payment submissions.
 */

import { Horizon } from "@stellar/stellar-sdk";

const MIN_FEE_STROOPS = 100;
// Matches the fee-bump ceiling in agent/tools.ts — a congestion spike in
// fee_charged.p90 should never push the *initial* target fee past what the
// retry logic treats as its own maximum.
const MAX_FEE_STROOPS = 100_000;

export interface GetTargetFeeOptions {
  /**
   * Cache time-to-live in milliseconds.
   * Defaults to 0 (direct fetch) when calling getTargetFee directly for backward compatibility,
   * or 5000ms (matching Stellar's ~5s ledger close time) when using getTargetFeeCached.
   */
  ttlMs?: number;
  /**
   * Force refresh the cache regardless of expiration.
   */
  forceRefresh?: boolean;
}

interface FeeCacheEntry {
  fee: string;
  cachedAt: number;
}

let cachedFeeEntry: FeeCacheEntry | null = null;
let inFlightFeePromise: Promise<string> | null = null;

/**
 * Clear the in-memory fee cache. Useful in tests and after network configuration switches.
 */
export function clearFeeCache(): void {
  cachedFeeEntry = null;
  inFlightFeePromise = null;
}

/**
 * Fetch the target fee from Horizon's /fee_stats endpoint.
 *
 * @param horizon - A connected Horizon.Server instance.
 * @param options - Optional caching parameters (ttlMs, forceRefresh).
 * @returns The p90 fee as a string, clamped to [100, 100000] stroops, or "100"
 *          on any error or missing/malformed fee_stats data.
 */
export async function getTargetFee(
  horizon: Horizon.Server,
  options?: GetTargetFeeOptions,
): Promise<string> {
  const ttlMs = options?.ttlMs ?? 0;
  const now = Date.now();

  if (
    !options?.forceRefresh &&
    ttlMs > 0 &&
    cachedFeeEntry !== null &&
    now - cachedFeeEntry.cachedAt < ttlMs
  ) {
    return cachedFeeEntry.fee;
  }

  if (inFlightFeePromise && !options?.forceRefresh && ttlMs > 0) {
    return inFlightFeePromise;
  }

  const fetchPromise = (async () => {
    try {
      const feeStats = await horizon.feeStats();
      const p90Fee = parseInt(feeStats?.fee_charged?.p90, 10);
      if (Number.isFinite(p90Fee) && p90Fee > 0) {
        const fee = String(Math.min(MAX_FEE_STROOPS, Math.max(MIN_FEE_STROOPS, p90Fee)));
        if (ttlMs > 0) {
          cachedFeeEntry = { fee, cachedAt: Date.now() };
        }
        return fee;
      }
      const fallback = String(MIN_FEE_STROOPS);
      if (ttlMs > 0) {
        cachedFeeEntry = { fee: fallback, cachedAt: Date.now() };
      }
      return fallback;
    } catch {
      const fallback = String(MIN_FEE_STROOPS);
      if (ttlMs > 0) {
        cachedFeeEntry = { fee: fallback, cachedAt: Date.now() };
      }
      return fallback;
    } finally {
      inFlightFeePromise = null;
    }
  })();

  if (ttlMs > 0) {
    inFlightFeePromise = fetchPromise;
  }

  return fetchPromise;
}

/**
 * Cached helper with default 5-second TTL matching Stellar ledger close intervals.
 */
export async function getTargetFeeCached(
  horizon: Horizon.Server,
  ttlMs = 5000,
): Promise<string> {
  return getTargetFee(horizon, { ttlMs });
}

