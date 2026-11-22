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

import type { Horizon } from "@stellar/stellar-sdk";

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


// ── Cumulative network fee tracking (#1232) ────────────────────────────────────

export const STROOPS_PER_XLM = 10_000_000;

/** A day's average fee at least this many times the range's typical fee is a spike. */
export const FEE_SPIKE_MULTIPLIER = 2;

/** Days of history the "all" range's trend covers; the totals still cover everything. */
const ALL_TIME_TREND_DAYS = 90;

export const NETWORK_FEE_RANGES = ["7d", "30d", "all"] as const;
export type NetworkFeeRange = (typeof NETWORK_FEE_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS: Record<NetworkFeeRange, number | null> = { "7d": 7, "30d": 30, all: null };

export interface NetworkFeeDay {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string;
  stroops: number;
  /** Transactions that paid a network fee that day. */
  count: number;
  /** Average fee per transaction that day (0 when count is 0). */
  averageStroops: number;
  /** Average fee was at least FEE_SPIKE_MULTIPLIER x the typical fee, e.g. network congestion. */
  spike: boolean;
}

export interface NetworkFeeSummary {
  totalStroops: number;
  totalXlm: number;
  /** Transactions with a recorded network fee. */
  count: number;
  averageStroops: number;
  maxStroops: number;
  /** Median per-transaction fee in the range: the "normal" level spikes are measured against. */
  typicalStroops: number;
  /** One entry per day, oldest first. Ranged views include zero-fee days so gaps are visible. */
  trend: NetworkFeeDay[];
  spikeDays: number;
}

export type NetworkFeeBreakdown = Record<NetworkFeeRange, NetworkFeeSummary>;

/** Just the fields fee tracking reads, so callers can pass any transaction shape. */
export interface FeeBearingTransaction {
  timestamp: string;
  networkFeeStroops?: number;
}

export function stroopsToXlm(stroops: number): number {
  return +(stroops / STROOPS_PER_XLM).toFixed(7);
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Cumulative Stellar network fees over one range, from the per-transaction
 * fee recorded when the agent submitted it. Transactions without a recorded
 * fee (x402/MPP settlements paid by a facilitator) are not counted.
 */
export function summarizeNetworkFees(
  transactions: readonly FeeBearingTransaction[],
  range: NetworkFeeRange,
  now: Date = new Date(),
): NetworkFeeSummary {
  const rangeDays = RANGE_DAYS[range];
  const windowStart = rangeDays === null ? -Infinity : now.getTime() - rangeDays * DAY_MS;

  const fees: number[] = [];
  const byDay = new Map<string, { stroops: number; count: number }>();
  for (const tx of transactions) {
    const fee = tx.networkFeeStroops;
    if (typeof fee !== "number" || !Number.isFinite(fee) || fee < 0) continue;
    const at = Date.parse(tx.timestamp);
    if (!Number.isFinite(at) || at < windowStart || at > now.getTime()) continue;
    fees.push(fee);
    const day = utcDay(at);
    const entry = byDay.get(day) ?? { stroops: 0, count: 0 };
    entry.stroops += fee;
    entry.count += 1;
    byDay.set(day, entry);
  }

  const totalStroops = fees.reduce((sum, fee) => sum + fee, 0);
  const typicalStroops = median(fees);
  const spikeFloor = Math.max(MIN_FEE_STROOPS, typicalStroops) * FEE_SPIKE_MULTIPLIER;

  const trendDays = rangeDays ?? ALL_TIME_TREND_DAYS;
  const trend: NetworkFeeDay[] = [];
  for (let i = trendDays - 1; i >= 0; i--) {
    const date = utcDay(now.getTime() - i * DAY_MS);
    const entry = byDay.get(date);
    // The all-time trend lists active days only; a 90-day strip of mostly
    // zeroes says nothing for a recipient with occasional bill payments.
    if (!entry && rangeDays === null) continue;
    const stroops = entry?.stroops ?? 0;
    const count = entry?.count ?? 0;
    const averageStroops = count > 0 ? Math.round(stroops / count) : 0;
    trend.push({ date, stroops, count, averageStroops, spike: count > 0 && averageStroops >= spikeFloor });
  }

  return {
    totalStroops,
    totalXlm: stroopsToXlm(totalStroops),
    count: fees.length,
    averageStroops: fees.length > 0 ? Math.round(totalStroops / fees.length) : 0,
    maxStroops: fees.length > 0 ? Math.max(...fees) : 0,
    typicalStroops,
    trend,
    spikeDays: trend.filter((day) => day.spike).length,
  };
}

/** Network fee summaries for every range the spending views offer. */
export function computeNetworkFeeBreakdown(
  transactions: readonly FeeBearingTransaction[],
  now: Date = new Date(),
): NetworkFeeBreakdown {
  return {
    "7d": summarizeNetworkFees(transactions, "7d", now),
    "30d": summarizeNetworkFees(transactions, "30d", now),
    all: summarizeNetworkFees(transactions, "all", now),
  };
}
