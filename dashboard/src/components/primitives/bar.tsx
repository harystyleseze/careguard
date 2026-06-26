export interface BarProps {
  label: string;
  spent?: number | null;
  budget?: number | null;
}

function finiteOrZero(value: number | null | undefined): number {
  const normalized = value ?? 0;
  return Number.isFinite(normalized) ? normalized : 0;
}

export function getBarPercent(spent?: number | null, budget?: number | null): number {
  const safeSpent = finiteOrZero(spent);
  const safeBudget = finiteOrZero(budget);

  if (safeBudget <= 0) {
    return 0;
  }

  const pct = (safeSpent / safeBudget) * 100;
  if (!Number.isFinite(pct)) {
    return 0;
  }

  return Math.max(0, Math.min(pct, 100));
}

export function Bar({ label, spent, budget }: BarProps) {
  const safeSpent = finiteOrZero(spent);
  const safeBudget = finiteOrZero(budget);
  const pct = getBarPercent(spent, budget);
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-sky-500";
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="text-slate-400">
          ${safeSpent.toFixed(2)} / ${safeBudget}
        </span>
      </div>
      <div
        className="h-2 bg-slate-100 rounded-full overflow-hidden"
        data-testid="bar-track"
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          data-testid="bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
