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

export function LowBalanceBanner({
  pausedReason,
  walletBalance,
  walletXlm,
  onResume,
}: LowBalanceBannerProps) {
  const copy = pausedReason ? REASON_COPY[pausedReason] : undefined;
  if (!copy) return null;

  return (
    <div role="alert" aria-live="assertive" className="bg-red-600 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
        <span aria-hidden className="text-sm font-semibold uppercase tracking-wide">
          Alert
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            Agent paused - low {copy.kind} balance.
          </p>
          <p className="text-xs text-red-100">
            USDC: {walletBalance ?? "-"} | XLM: {walletXlm ?? "-"}.
            {` ${copy.suffix}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onResume}
          className="min-h-11 rounded-md bg-white px-4 py-3 text-sm font-semibold text-red-700 transition-colors cursor-pointer hover:bg-red-50 active:bg-red-100"
        >
          Resume agent
        </button>
      </div>
    </div>
  );
}
