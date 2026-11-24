"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { agentFetch } from "../lib/agent-fetch";
import {
  AdherenceTimelineEventSchema,
  VITAL_DEFAULT_UNIT,
  VITAL_TYPES,
  VitalSchema,
  formatVital,
  type AdherenceTimelineEvent,
  type Vital,
  type VitalType,
} from "../lib/types";
import { formatDate, getTranslations, type Locale } from "../i18n";

// Validated categorical pair (CVD ΔE ≥ 23): primary reading, then diastolic.
const SERIES_COLORS = ["#0284c7", "#ea580c"] as const;

const CHART_W = 640;
const CHART_H = 220;
const PAD = { top: 16, right: 56, bottom: 44, left: 44 };
const MARKER_ROW_Y = CHART_H - 14;

export interface VitalsSectionProps {
  recipientId?: string;
  locale?: Locale;
  /** Lets the parent include logged vitals in the health-summary export. */
  onVitalsChange?: (vitals: Vital[]) => void;
}

function typeLabel(type: VitalType, t: ReturnType<typeof getTranslations>["vitals"]) {
  return type === "weight" ? t.weight : type === "blood_pressure" ? t.bloodPressure : t.glucose;
}

/**
 * Manual vitals logging (#1237): a small entry form plus a trend chart that
 * overlays medication adherence events, so caregivers can see whether
 * readings move with doses taken or missed.
 */
export function VitalsSection({ recipientId = "rosa", locale = "en", onVitalsChange }: VitalsSectionProps) {
  const t = getTranslations(locale).vitals;
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [adherence, setAdherence] = useState<AdherenceTimelineEvent[]>([]);
  const [selected, setSelected] = useState<VitalType>("blood_pressure");
  const [value, setValue] = useState("");
  const [secondary, setSecondary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const query = `recipient_id=${encodeURIComponent(recipientId)}`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      agentFetch(`/agent/vitals?${query}`),
      agentFetch(`/agent/adherence/timeline?${query}`),
    ])
      .then(async ([vRes, aRes]) => {
        const vBody = vRes.ok ? await vRes.json() : null;
        const aBody = aRes.ok ? await aRes.json() : null;
        if (cancelled) return;
        const parsedVitals = VitalSchema.array().safeParse(vBody?.vitals);
        if (parsedVitals.success) setVitals(parsedVitals.data);
        const parsedEvents = AdherenceTimelineEventSchema.array().safeParse(aBody?.events);
        if (parsedEvents.success) setAdherence(parsedEvents.data);
      })
      .catch(() => {
        // Offline agent — the section still renders its empty state.
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    onVitalsChange?.(vitals);
  }, [vitals, onVitalsChange]);

  const isBp = selected === "blood_pressure";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const primary = Number(value);
    const diastolic = Number(secondary);
    if (!value || !Number.isFinite(primary) || primary <= 0 || (isBp && (!secondary || !Number.isFinite(diastolic) || diastolic <= 0))) {
      setError(t.invalid);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await agentFetch(`/agent/vitals?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: selected,
          value: primary,
          ...(isBp ? { secondary_value: diastolic } : {}),
          unit: VITAL_DEFAULT_UNIT[selected],
        }),
      });
      if (!res.ok) {
        setError(t.saveFailed);
        return;
      }
      const created = VitalSchema.safeParse(await res.json());
      if (created.success) setVitals((prev) => [...prev, created.data]);
      setValue("");
      setSecondary("");
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const series = useMemo(
    () =>
      vitals
        .filter((v) => v.type === selected)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [vitals, selected],
  );

  return (
    <section
      aria-labelledby="vitals-title"
      className="bg-white rounded-xl border border-slate-200 p-6"
    >
      <h2 id="vitals-title" className="text-sm font-semibold text-slate-700 mb-1">
        {t.title}
      </h2>
      <p className="text-xs text-slate-500 mb-4">{t.description}</p>

      <div role="group" aria-label={t.typeLabel} className="flex flex-wrap gap-2 mb-4">
        {VITAL_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={selected === type}
            onClick={() => {
              setSelected(type);
              setError(null);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${
              selected === type
                ? "bg-sky-500 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {typeLabel(type, t)}
          </button>
        ))}
      </div>

      <form noValidate onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 mb-6">
        <div>
          <label htmlFor="vital-value" className="block text-xs font-medium text-slate-600 mb-1">
            {isBp ? t.systolic : typeLabel(selected, t)} ({VITAL_DEFAULT_UNIT[selected]})
          </label>
          <input
            id="vital-value"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        {isBp && (
          <div>
            <label htmlFor="vital-secondary" className="block text-xs font-medium text-slate-600 mb-1">
              {t.diastolic} (mmHg)
            </label>
            <input
              id="vital-secondary"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={secondary}
              onChange={(e) => setSecondary(e.target.value)}
              className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t.log}
        </button>
        {error && (
          <p role="alert" className="w-full text-xs text-red-600">
            {error}
          </p>
        )}
      </form>

      {series.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{t.empty}</p>
      ) : (
        <>
          <VitalsTrendChart
            series={series}
            adherence={adherence}
            locale={locale}
            label={typeLabel(selected, t)}
            t={t}
          />
          <table className="mt-4 w-full text-xs">
            <caption className="text-left text-slate-500 mb-1">{t.recent}</caption>
            <thead>
              <tr className="text-left text-slate-500">
                <th className="font-medium py-1">{t.date}</th>
                <th className="font-medium py-1">{t.reading}</th>
              </tr>
            </thead>
            <tbody>
              {series.slice(-5).reverse().map((v) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-600">{formatDate(v.timestamp, locale)}</td>
                  <td className="py-1 font-medium text-slate-700">{formatVital(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

interface ChartPoint {
  x: number;
  y: number;
  vital: Vital;
}

function VitalsTrendChart({
  series,
  adherence,
  locale,
  label,
  t,
}: {
  series: Vital[];
  adherence: AdherenceTimelineEvent[];
  locale: Locale;
  label: string;
  t: ReturnType<typeof getTranslations>["vitals"];
}) {
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const isBp = series[0]?.type === "blood_pressure";

  const times = series.map((v) => new Date(v.timestamp).getTime());
  let tMin = Math.min(...times);
  let tMax = Math.max(...times);
  if (tMin === tMax) {
    tMin -= 86_400_000;
    tMax += 86_400_000;
  }
  const markers = adherence.filter((a) => {
    const ts = new Date(a.date).getTime();
    return ts >= tMin && ts <= tMax;
  });

  const values = series.flatMap((v) => (isBp && v.secondary_value != null ? [v.value, v.secondary_value] : [v.value]));
  let vMin = Math.min(...values);
  let vMax = Math.max(...values);
  const span = vMax - vMin || Math.max(1, vMax * 0.1);
  vMin = Math.max(0, vMin - span * 0.15);
  vMax = vMax + span * 0.15;

  const plotBottom = CHART_H - PAD.bottom;
  const xOf = (ts: number) => PAD.left + ((ts - tMin) / (tMax - tMin)) * (CHART_W - PAD.left - PAD.right);
  const yOf = (v: number) => plotBottom - ((v - vMin) / (vMax - vMin)) * (plotBottom - PAD.top);

  const primary: ChartPoint[] = series.map((v) => ({ x: xOf(new Date(v.timestamp).getTime()), y: yOf(v.value), vital: v }));
  const lines: Array<{ name: string; color: string; points: ChartPoint[] }> = [
    { name: isBp ? t.systolic : label, color: SERIES_COLORS[0], points: primary },
  ];
  if (isBp) {
    lines.push({
      name: t.diastolic,
      color: SERIES_COLORS[1],
      points: series
        .filter((v) => v.secondary_value != null)
        .map((v) => ({ x: xOf(new Date(v.timestamp).getTime()), y: yOf(v.secondary_value!), vital: v })),
    });
  }

  const ticks = [vMin, (vMin + vMax) / 2, vMax];
  const path = (pts: ChartPoint[]) => pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-2 text-xs text-slate-600" aria-hidden="true">
        {lines.length > 1 &&
          lines.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: l.color }} />
              {l.name}
            </span>
          ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="text-green-600">✓</span>
          {t.doseTaken}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-red-600">✕</span>
          {t.doseMissed}
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto"
          role="img"
          aria-label={`${label} ${t.trendAria}: ${series.length} ${t.readings}, ${markers.length} ${t.adherenceEvents}`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={yOf(v)} y2={yOf(v)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={PAD.left - 6} y={yOf(v) + 3} textAnchor="end" fontSize={10} fill="#64748b">
                {Math.round(v)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={plotBottom + 14} fontSize={10} fill="#64748b">
            {formatDate(new Date(tMin), locale)}
          </text>
          <text x={CHART_W - PAD.right} y={plotBottom + 14} textAnchor="end" fontSize={10} fill="#64748b">
            {formatDate(new Date(tMax), locale)}
          </text>

          {/* Adherence markers sit in their own row under the plot. */}
          {markers.map((m) => {
            const x = xOf(new Date(m.date).getTime());
            const taken = m.status === "confirmed";
            const missed = m.status === "skipped" || m.status === "flagged";
            return (
              <g key={m.id}>
                <line x1={x} x2={x} y1={PAD.top} y2={plotBottom} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="2 3" />
                <text
                  x={x}
                  y={MARKER_ROW_Y}
                  textAnchor="middle"
                  fontSize={11}
                  fill={taken ? "#16a34a" : missed ? "#dc2626" : "#94a3b8"}
                >
                  <title>{`${m.drug}: ${taken ? t.doseTaken : missed ? t.doseMissed : t.dosePending} (${formatDate(m.date, locale)})`}</title>
                  {taken ? "✓" : missed ? "✕" : "○"}
                </text>
              </g>
            );
          })}

          {lines.map((l) => (
            <g key={l.name}>
              <path d={path(l.points)} fill="none" stroke={l.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {l.points.map((p) => (
                <circle key={p.vital.id} cx={p.x} cy={p.y} r={4} fill={l.color} stroke="#fff" strokeWidth={2} />
              ))}
              {/* Direct label at the line's end so identity isn't color-only. */}
              {lines.length > 1 && l.points.length > 0 && (
                <text
                  x={l.points[l.points.length - 1].x + 8}
                  y={l.points[l.points.length - 1].y + 3}
                  fontSize={10}
                  fill="#334155"
                >
                  {l.name}
                </text>
              )}
            </g>
          ))}

          {/* Oversized invisible hit targets for hover/focus tooltips. */}
          {primary.map((p) => (
            <circle
              key={`hit-${p.vital.id}`}
              cx={p.x}
              cy={p.y}
              r={12}
              fill="transparent"
              tabIndex={0}
              aria-label={`${formatDate(p.vital.timestamp, locale)}: ${formatVital(p.vital)}`}
              onMouseEnter={() => setHover(p)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover(null)}
            />
          ))}
          {hover && (
            <line x1={hover.x} x2={hover.x} y1={PAD.top} y2={plotBottom} stroke="#94a3b8" strokeWidth={1} pointerEvents="none" />
          )}
        </svg>
        {hover && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm"
            style={{ left: `${(hover.x / CHART_W) * 100}%`, transform: "translateX(-50%)" }}
          >
            <div className="text-slate-500">{formatDate(hover.vital.timestamp, locale)}</div>
            <div className="font-semibold text-slate-800">{formatVital(hover.vital)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
