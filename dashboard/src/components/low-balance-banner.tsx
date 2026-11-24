"use client";

import { useEffect, useState } from "react";

export interface AutoTopupRule {
  enabled: boolean;
  threshold: number;
  topUpAmount: number;
  fundingSource: "USDC" | "XLM";
}

interface LowBalanceBannerProps {
  pausedReason: string | null;
  walletBalance: string | null;
  walletXlm: string | null;
  onResume: () => void;
  autoTopupRule?: AutoTopupRule;
  onConfigureAutoTopup?: (rule: AutoTopupRule) => void;
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
  autoTopupRule = { enabled: true, threshold: 10, topUpAmount: 50, fundingSource: "USDC" },
  onConfigureAutoTopup = () => undefined,
}: LowBalanceBannerProps) {
  const copy = pausedReason ? REASON_COPY[pausedReason] : undefined;
  const [rule, setRule] = useState<AutoTopupRule>(autoTopupRule);

  useEffect(() => {
    setRule(autoTopupRule);
  }, [autoTopupRule]);

  if (!copy) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-amber-50 border-b border-amber-200 text-slate-700"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <span aria-hidden className="text-lg">💰</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Add funds to resume</p>
          <p className="text-xs text-slate-600">
            {copy.kind} balance: {copy.kind === "USDC" ? walletBalance : walletXlm ?? "—"}. {copy.suffix}
          </p>
        </div>
        <button
          type="button"
          onClick={onResume}
          className="text-sm font-semibold rounded-md bg-amber-600 text-white px-3 py-1.5 hover:bg-amber-700 active:bg-amber-800 transition-colors cursor-pointer"
        >
          Resume agent
        </button>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-4">
        <div className="rounded-lg border border-amber-200 bg-white/80 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Auto-topup</p>
              <p className="text-xs text-slate-600">Top up ${rule.topUpAmount} when balance drops below ${rule.threshold}.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => setRule((prev) => ({ ...prev, enabled: e.target.checked }))}
              />
              Enabled
            </label>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-slate-600">
              Threshold
              <input
                type="number"
                min="0"
                step="1"
                value={rule.threshold}
                onChange={(e) => setRule((prev) => ({ ...prev, threshold: Number(e.target.value) || 0 }))}
                className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
            <label className="text-xs text-slate-600">
              Top-up amount
              <input
                type="number"
                min="0"
                step="5"
                value={rule.topUpAmount}
                onChange={(e) => setRule((prev) => ({ ...prev, topUpAmount: Number(e.target.value) || 0 }))}
                className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              />
            </label>
            <label className="text-xs text-slate-600">
              Funding source
              <select
                value={rule.fundingSource}
                onChange={(e) => setRule((prev) => ({ ...prev, fundingSource: e.target.value as "USDC" | "XLM" }))}
                className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                <option value="USDC">USDC</option>
                <option value="XLM">XLM</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onConfigureAutoTopup(rule)}
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
            >
              Save auto-topup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
