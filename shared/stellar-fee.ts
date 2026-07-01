/**
 * Dynamic Stellar fee selection.
 *
 * Reads Horizon /fee_stats and targets the p90 fee charged in the
 * recent ledger history. Falls back to "100" stroops on any error.
 */

import { Horizon } from "@stellar/stellar-sdk";

const MIN_FEE_STROOPS = 100;

/**
 * Fetch the target fee from Horizon's /fee_stats endpoint.
 *
 * @param horizon - A connected Horizon.Server instance.
 * @returns The p90 fee as a string, or "100" on error.
 */
export async function getTargetFee(horizon: Horizon.Server): Promise<string> {
  try {
    const feeStats = await horizon.feeStats();
    const p90Fee = parseInt(feeStats.fee_charged.p90, 10);
    if (Number.isFinite(p90Fee) && p90Fee > 0) {
      return String(Math.max(MIN_FEE_STROOPS, p90Fee));
    }
    return String(MIN_FEE_STROOPS);
  } catch {
    return String(MIN_FEE_STROOPS);
  }
}
