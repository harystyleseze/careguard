export interface CardProps {
  label: string;
  value: string;
  sub: string;
  color: "sky" | "green" | "amber" | "slate";
}

const COLORS: Record<CardProps["color"], string> = {
  sky: "border-sky-200 bg-sky-50",
  green: "border-green-200 bg-green-50",
  amber: "border-amber-200 bg-amber-50",
  slate: "border-slate-200 bg-white",
};

export function Card({ label, value, sub, color }: CardProps) {
  return (
    <div className={`rounded-xl border p-4 ${COLORS[color]}`}>
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{sub}</div>
    </div>
  );
}
