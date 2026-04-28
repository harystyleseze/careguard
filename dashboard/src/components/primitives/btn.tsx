export interface BtnProps {
  label: string;
  desc: string;
  busy: boolean;
  onClick: () => void;
}

export function Btn({ label, desc, busy, onClick }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-left p-4 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 rounded-lg border border-slate-200 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-slate-500 mt-1">{desc}</div>
    </button>
  );
}
