"use client";

import { useId, useState } from "react";
import { formatCurrency, getTranslations, type Locale } from "../i18n";
import type { SpendingData } from "./types";

export type SpendingRange = "7d" | "30d" | "all";

export interface CategoryRow {
  key: "medications" | "bills" | "serviceFees";
  label: string;
  amount: number;
  /** Share of the range total, 0–100. */
  pct: number;
}

const BAR_STYLES: Record<CategoryRow["key"], string> = {
  medications: "bg-sky-500",
  bills: "bg-violet-500",
  serviceFees: "bg-amber-500",
};

/**
 * Category totals for a range (#1185). Uses the agent's `categoryBreakdown`
 * when present; older agents only send all-time `spending` totals, which are
 * used for the "all" range.
 */
export function categoryRows(
  spending: SpendingData,
  range: SpendingRange,
  labels: Record<CategoryRow["key"], string>,
): { rows: CategoryRow[]; total: number } {
  const source = spending.categoryBreakdown?.[range] ?? spending.spending;
  const amounts: Record<CategoryRow["key"], number> = {
    medications: Math.max(0, source.medications || 0),
    bills: Math.max(0, source.bills || 0),
    serviceFees: Math.max(0, source.serviceFees || 0),
  };
  const total = amounts.medications + amounts.bills + amounts.serviceFees;
  const rows = (Object.keys(amounts) as CategoryRow["key"][]).map((key) => ({
    key,
    label: labels[key],
    amount: amounts[key],
    pct: total > 0 ? (amounts[key] / total) * 100 : 0,
  }));
  return { rows, total };
}

export function SpendingCategoryChart({ spending, locale = "en" }: { spending: SpendingData; locale?: Locale }) {
  const t = getTranslations(locale);
  const headingId = useId();
  const hasRanges = Boolean(spending.categoryBreakdown);
  const [range, setRange] = useState<SpendingRange>(hasRanges ? "30d" : "all");
  const activeRange: SpendingRange = hasRanges ? range : "all";
  const { rows, total } = categoryRows(spending, activeRange, {
    medications: t.wallet.categoryMedications,
    bills: t.wallet.categoryBills,
    serviceFees: t.wallet.categoryFees,
  });
  const ranges: Array<{ value: SpendingRange; label: string }> = [
    { value: "7d", label: t.wallet.range7d },
    { value: "30d", label: t.wallet.range30d },
    { value: "all", label: t.wallet.rangeAll },
  ];
  // Fees are fractions of a cent, so show more precision for them.
  const money = (row: CategoryRow) =>
    formatCurrency(row.amount, locale, row.key === "serviceFees" && row.amount > 0 && row.amount < 0.01 ? 4 : 2);

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-slate-700">
            {t.wallet.spendingByCategory}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.wallet.spendingByCategoryDesc}</p>
        </div>
        {hasRanges && (
          <div role="radiogroup" aria-label={t.wallet.breakdownRange} className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={activeRange === r.value}
                onClick={() => setRange(r.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all ${
                  activeRange === r.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!hasRanges && <p className="text-xs text-slate-500 mb-3">{t.wallet.rangeUnavailable}</p>}

      {total === 0 ? (
        <p className="text-sm text-slate-500" role="status">
          {t.wallet.noSpendingInRange}
        </p>
      ) : (
        <>
          {/* Every bar is labelled with its category, amount and share, so the
              chart never relies on colour alone; the bars themselves are decorative. */}
          <ul className="space-y-3" aria-label={t.wallet.spendingByCategory}>
            {rows.map((row) => (
              <li key={row.key} data-testid={`category-${row.key}`}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-700">{row.label}</span>
                  <span className="text-slate-600 tabular-nums">
                    {money(row)} <span className="text-slate-400">({Math.round(row.pct)}%)</span>
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden" aria-hidden="true">
                  <div className={`h-full rounded-full ${BAR_STYLES[row.key]}`} style={{ width: `${row.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between text-xs mt-4 pt-3 border-t border-slate-100">
            <span className="font-semibold text-slate-700">{t.wallet.breakdownTotal}</span>
            <span className="font-semibold text-slate-900 tabular-nums">{formatCurrency(total, locale, 2)}</span>
          </div>
        </>
      )}
    </section>
  );
}
