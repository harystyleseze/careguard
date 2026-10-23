"use client";

import { useId, useState } from "react";
import { formatDate, formatNumber, getTranslations, type Locale } from "../i18n";
import type { NetworkFeeSummary } from "../lib/types";
import type { SpendingData } from "./types";
import type { SpendingRange } from "./spending-category-chart";

/** Mirrors FEE_SPIKE_MULTIPLIER in shared/stellar-fee.ts. */
const FEE_SPIKE_MULTIPLIER = 2;

function formatXlm(xlm: number, locale: Locale): string {
  // Fees are a few hundred stroops each, so trim trailing zeros but keep 7 dp precision.
  return `${new Intl.NumberFormat(locale === "es" ? "es-ES" : "en-US", { maximumFractionDigits: 7 }).format(xlm)} XLM`;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

/**
 * Cumulative Stellar network fees (#1232), shown apart from the medication and
 * bill totals in SpendingCategoryChart, with the same time ranges and a daily
 * trend so congestion-driven fee spikes stand out.
 */
export function NetworkFeesCard({ spending, locale = "en" }: { spending: SpendingData; locale?: Locale }) {
  const t = getTranslations(locale).wallet;
  const headingId = useId();
  const [range, setRange] = useState<SpendingRange>("30d");
  const ranges: Array<{ value: SpendingRange; label: string }> = [
    { value: "7d", label: t.range7d },
    { value: "30d", label: t.range30d },
    { value: "all", label: t.rangeAll },
  ];
  const summary: NetworkFeeSummary | undefined = spending.networkFees?.[range];

  return (
    <section
      className="bg-white rounded-xl border border-slate-200 p-6"
      aria-labelledby={headingId}
      data-testid="network-fees-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 id={headingId} className="text-sm font-semibold text-slate-700">
            {t.networkFees}
          </h2>
          <p className="text-xs text-slate-500 mt-1">{t.networkFeesDesc}</p>
        </div>
        {spending.networkFees && (
          <div role="radiogroup" aria-label={t.breakdownRange} className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={range === r.value}
                onClick={() => setRange(r.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-all ${
                  range === r.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!summary ? (
        <p className="text-sm text-slate-500" role="status">
          {t.networkFeesUnavailable}
        </p>
      ) : summary.count === 0 ? (
        <p className="text-sm text-slate-500" role="status">
          {t.networkFeesNone}
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-medium text-slate-600">{t.networkFeesTotal}</span>
            <span className="text-lg font-semibold text-slate-900 tabular-nums" data-testid="network-fees-total">
              {formatXlm(summary.totalXlm, locale)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 text-right">
            {fill(t.networkFeesCount, {
              count: formatNumber(summary.count, locale),
              avg: formatNumber(summary.averageStroops, locale),
            })}
          </p>
          <FeeTrend summary={summary} locale={locale} />
        </>
      )}
    </section>
  );
}

function FeeTrend({ summary, locale }: { summary: NetworkFeeSummary; locale: Locale }) {
  const t = getTranslations(locale).wallet;
  const peak = Math.max(1, ...summary.trend.map((day) => day.averageStroops));

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <h3 className="text-xs font-semibold text-slate-600 mb-2">{t.networkFeesTrend}</h3>
      {/* Bars show each day's average fee per transaction; spike days are also
          labelled in text below, so colour isn't the only signal. */}
      <ol className="flex items-end gap-px h-16" aria-label={t.networkFeesTrend}>
        {summary.trend.map((day) => {
          // Noon UTC keeps the calendar day stable in every viewer timezone.
          const label = `${formatDate(`${day.date}T12:00:00Z`, locale)}: ${formatNumber(day.stroops, locale)} stroops, ${day.count} tx${
            day.spike ? ` — ${t.networkFeesSpike}` : ""
          }`;
          return (
            <li
              key={day.date}
              className="flex-1 min-w-[2px] h-full flex items-end"
              title={label}
              data-testid={day.spike ? "fee-spike-day" : undefined}
            >
              <span className="sr-only">{label}</span>
              <div
                aria-hidden="true"
                className={`w-full rounded-sm ${day.spike ? "bg-red-500" : day.count > 0 ? "bg-teal-500" : "bg-slate-100"}`}
                style={{ height: `${day.count > 0 ? Math.max(8, (day.averageStroops / peak) * 100) : 4}%` }}
              />
            </li>
          );
        })}
      </ol>
      <p className={`text-xs mt-2 ${summary.spikeDays > 0 ? "text-red-600" : "text-slate-500"}`} role="status">
        {summary.spikeDays > 0
          ? fill(t.networkFeesSpikeNote, {
              days: summary.spikeDays,
              multiplier: FEE_SPIKE_MULTIPLIER,
              typical: formatNumber(summary.typicalStroops, locale),
            })
          : t.networkFeesNoSpikes}
      </p>
    </div>
  );
}
