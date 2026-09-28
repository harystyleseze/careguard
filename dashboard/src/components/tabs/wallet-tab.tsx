"use client";

import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { truncateAddress } from "../../lib/utils";
import { Toast } from "../primitives/toast";
import type { AgentInfo } from "../types";
import { EXPLORER_ACCOUNT_URL, NETWORK_LABEL } from "../../lib/stellar-network";
import { getTranslations, type Locale } from "../../i18n";

export interface WalletTabProps {
  agentInfo: AgentInfo | null;
  walletBalance: string | null;
  walletXlm: string | null;
  walletBalanceState?: 'loading' | 'ok' | 'error';
  walletBalanceError?: string | null;
  loadingWalletBalance?: boolean;
  onRetryWalletBalance?: () => void;
  locale?: Locale;
}

function FundingModal({
  isOpen,
  onClose,
  onContinue,
  locale = "en",
}: {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  locale?: Locale;
}) {
  const t = getTranslations(locale);
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            {t.wallet.fundModal}
          </h2>
          <p className="text-sm text-slate-600 mb-4">
            {t.wallet.fundModalDesc}
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <p className="text-xs text-blue-700 font-medium flex items-start gap-2">
              <span className="text-blue-600 font-bold flex-shrink-0">⚠</span>
              <span>{t.wallet.fundModalNote}</span>
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={onContinue}
              className="flex-1 px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 transition-all"
            >
              {t.wallet.fundContinue}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function WalletTab({
  agentInfo,
  walletBalance,
  walletXlm,
  walletBalanceState = 'loading',
  walletBalanceError,
  loadingWalletBalance = false,
  onRetryWalletBalance,
  locale = "en",
}: WalletTabProps) {
  const t = getTranslations(locale);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [fundingModalOpen, setFundingModalOpen] = useState(false);

  const handleCopy = async (text: string, id: string) => {
    const result = await copyText(text);
    if (result === "ok" || result === "fallback") {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      return;
    }
    setToastMsg("Couldn't copy. Press Ctrl+C.");
    setToastFallback(text);
  };

  return (
    <div
      role="tabpanel"
      id="tabpanel-wallet"
      aria-labelledby="tab-wallet"
      tabIndex={0}
      className="space-y-6 max-w-2xl"
    >
      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onDismiss={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
      <FundingModal
        isOpen={fundingModalOpen}
        onClose={() => setFundingModalOpen(false)}
        onContinue={() => {
          setFundingModalOpen(false);
          window.open("https://faucet.circle.com", "_blank", "noopener,noreferrer");
        }}
        locale={locale}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t.wallet.title}</h2>
        <p className="text-xs text-slate-500 mb-4">
          {t.wallet.description}
        </p>
        <div className="grid grid-cols-2 gap-4 mb-6">
          {walletBalanceState === 'loading' && (
            <div className="bg-sky-50 rounded-lg p-4 text-center border border-sky-200 col-span-2">
              <div className="text-sm font-medium text-sky-600">
                <span className="inline-block w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin mr-2 align-middle" />
                {t.common.loading}
              </div>
            </div>
          )}
          {walletBalanceState === 'error' && (
            <div className="bg-red-50 rounded-lg p-4 text-center border border-red-200 col-span-2">
              <div className="text-sm font-medium text-red-700 mb-2">
                {walletBalanceError || t.wallet.balanceUnavailable}
              </div>
              {onRetryWalletBalance && (
                <button
                  onClick={onRetryWalletBalance}
                  disabled={loadingWalletBalance}
                  className="px-4 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 disabled:opacity-50 cursor-pointer transition-all"
                >
                  {loadingWalletBalance ? `${t.common.retry}...` : t.common.retry}
                </button>
              )}
            </div>
          )}
          {walletBalanceState === 'ok' && (
            <>
              <div className="bg-sky-50 rounded-lg p-4 text-center border border-sky-200">
                <div className="text-2xl font-bold text-sky-700">
                  ${walletBalance ?? "0.00"}
                </div>
                <div className="text-xs text-slate-500 mt-1">{t.wallet.usdcBalance}</div>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 text-center border border-slate-200">
                <div className="text-2xl font-bold text-slate-700">
                  {walletXlm ?? "0.00"}
                </div>
                <div className="text-xs text-slate-500 mt-1">{t.wallet.xlmBalance}</div>
              </div>
            </>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t.wallet.walletAddress}
            </label>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                title={agentInfo?.agentWallet || ""}
              >
                {agentInfo?.agentWallet ? truncateAddress(agentInfo.agentWallet) : t.settings.notConnected}
              </code>
              {agentInfo?.agentWallet && (
                <button
                  onClick={() =>
                    handleCopy(agentInfo.agentWallet, "wallet-address")
                  }
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${copiedId === "wallet-address"
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                >
                  {copiedId === "wallet-address" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t.wallet.network}
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              {NETWORK_LABEL}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t.wallet.llmProvider}
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              {agentInfo?.llm || t.settings.notConnected}
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          {agentInfo?.agentWallet && (
            <a
              href={`${EXPLORER_ACCOUNT_URL}/${agentInfo.agentWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 active:bg-sky-700 cursor-pointer transition-all"
            >
              {t.wallet.viewExplorer}
            </a>
          )}
          <button
            onClick={() => setFundingModalOpen(true)}
            className="flex-1 text-center px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 active:bg-slate-300 cursor-pointer transition-all"
          >
            {t.wallet.fund}
          </button>
        </div>
        {agentInfo?.agentWallet && (
          <p className="mt-2 text-xs text-slate-500 text-center">
            Stellar Explorer shows a public record of this wallet's transactions on the blockchain
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          {t.wallet.howPayments}
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Payments are made securely using digital dollars on a public ledger, ensuring transparency and traceability for all healthcare transactions.
        </p>
        <div className="space-y-3 text-xs text-slate-600">
          <div className="flex gap-3 items-start">
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded font-medium shrink-0">
              x402
            </span>
            <span>
              API queries (pharmacy prices, bill audits, drug interactions) are
              paid per-request via x402. The agent signs a Soroban authorization
              entry, and the OZ Facilitator settles the payment on Stellar.
            </span>
          </div>
          <div className="flex gap-3 items-start">
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium shrink-0">
              MPP
            </span>
            <span>
              Medication orders are paid via MPP Charge mode. The agent signs a
              Soroban SAC transfer, and the pharmacy server broadcasts the
              transaction.
            </span>
          </div>
          <div className="flex gap-3 items-start">
            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded font-medium shrink-0">
              USDC
            </span>
            <span>
              Bill payments are direct Stellar USDC transfers. The agent builds
              a payment transaction, signs it, and submits to Horizon.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
