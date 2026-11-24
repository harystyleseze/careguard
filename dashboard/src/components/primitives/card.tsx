export interface CardProps {
  label: string;
  value: string;
  sub: string;
  color: "sky" | "green" | "amber" | "slate";
  /**
   * #1239: the metric has no data yet (e.g. no agent task has run), as
   * opposed to a genuine zero. Renders a muted, dashed card that shows
   * `value` as a placeholder and `sub` as the call to action.
   */
  pending?: boolean;
}

const COLORS: Record<CardProps["color"], string> = {
  sky: "border-sky-200 bg-sky-50",
  green: "border-green-200 bg-green-50",
  amber: "border-amber-200 bg-amber-50",
  slate: "border-slate-200 bg-white",
};

export function Card({ label, value, sub, color, pending = false }: CardProps) {
  if (pending) {
    return (
      <div
        data-pending="true"
        className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4"
      >
        <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
        <div className="text-base font-medium text-slate-400">{value}</div>
        <div className="text-xs text-slate-500 mt-1">{sub}</div>
      </div>
    );
  }
  return (
    <div className={`rounded-xl border p-4 ${COLORS[color]}`}>
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{sub}</div>
    </div>
  );
}
