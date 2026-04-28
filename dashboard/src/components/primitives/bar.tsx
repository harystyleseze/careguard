export interface BarProps {
  label: string;
  spent: number;
  budget: number;
}

export function Bar({ label, spent, budget }: BarProps) {
  const pct = Math.min((spent / budget) * 100, 100);
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-sky-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">
          ${spent.toFixed(2)} / ${budget}
        </span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
