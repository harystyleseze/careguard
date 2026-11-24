// Spending grouped by category over fixed time ranges (#1185).
import { TRANSACTION_CATEGORY, type Transaction } from "../shared/types.ts";

export const BREAKDOWN_RANGES = ["7d", "30d", "all"] as const;
export type BreakdownRange = (typeof BREAKDOWN_RANGES)[number];

export interface CategoryTotals {
  /** Pharmacy orders. */
  medications: number;
  /** Bill payments, at the amount paid after the bill audit's adjustments. */
  bills: number;
  /** Per-request API fees (pharmacy prices, bill audits, interaction checks). */
  serviceFees: number;
  total: number;
  /** Completed transactions counted in this range. */
  count: number;
}

export type CategoryBreakdown = Record<BreakdownRange, CategoryTotals>;

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_MS: Record<BreakdownRange, number | null> = {
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  all: null,
};

const empty = (): CategoryTotals => ({ medications: 0, bills: 0, serviceFees: 0, total: 0, count: 0 });

/**
 * Totals per category for each range, from completed transactions only:
 * pending, blocked, rejected or cancelled payments never moved money.
 * Rounding matches getSpendingSummary (fees keep 4 decimals).
 */
export function computeCategoryBreakdown(
  transactions: readonly Pick<Transaction, "amount" | "category" | "status" | "timestamp">[],
  now: Date = new Date(),
): CategoryBreakdown {
  const out = { "7d": empty(), "30d": empty(), all: empty() } as CategoryBreakdown;
  for (const tx of transactions) {
    if (tx.status !== "completed" || !Number.isFinite(tx.amount)) continue;
    const at = Date.parse(tx.timestamp);
    for (const range of BREAKDOWN_RANGES) {
      const window = RANGE_MS[range];
      if (window !== null && (!Number.isFinite(at) || now.getTime() - at > window)) continue;
      const totals = out[range];
      if (tx.category === TRANSACTION_CATEGORY.MEDICATIONS) totals.medications += tx.amount;
      else if (tx.category === TRANSACTION_CATEGORY.BILLS) totals.bills += tx.amount;
      else if (tx.category === TRANSACTION_CATEGORY.SERVICE_FEES) totals.serviceFees += tx.amount;
      else continue;
      totals.count += 1;
    }
  }
  for (const range of BREAKDOWN_RANGES) {
    const t = out[range];
    t.total = +(t.medications + t.bills + t.serviceFees).toFixed(2);
    t.medications = +t.medications.toFixed(2);
    t.bills = +t.bills.toFixed(2);
    t.serviceFees = +t.serviceFees.toFixed(4);
  }
  return out;
}
