"use client";

interface LowBalanceBannerProps {
  pausedReason: string | null;
  walletBalance: string | null;
  walletXlm: string | null;
  onResume: () => void;
}

const REASON_COPY: Record<string, { kind: string; suffix: string }> = {
  "low-balance-usdc": {
    kind: "USDC",
    suffix: "Fund the agent wallet with testnet USDC, then resume the agent.",
  },
  "low-balance-xlm": {
    kind: "XLM",
    suffix: "Fund the agent wallet with XLM (for transaction fees), then resume the agent.",
  },
};

export function LowBalanceBanner({ pausedReason, walletBalance, walletXlm, onResume }: LowBalanceBannerProps) {
  const copy = pausedReason ? REASON_COPY[pausedReason] : undefined;
  if (!copy) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-red-600 text-white"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <span aria-hidden className="text-lg">🚨</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            Agent paused — low {copy.kind} balance.
          </p>
          <p className="text-xs text-red-100">
            USDC: {walletBalance ?? "—"} · XLM: {walletXlm ?? "—"}. {copy.suffix}
          </p>
        </div>
        <button
          type="button"
          onClick={onResume}
          className="text-sm font-semibold rounded-md bg-white text-red-700 px-3 py-1.5 hover:bg-red-50 active:bg-red-100 transition-colors cursor-pointer"
        >
          Resume agent
        </button>
      </div>
    </div>
  );
}
