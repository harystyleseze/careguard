"use client";

import { useState, useEffect } from "react";
import { copyText } from "../../lib/clipboard";
import { truncateAddress } from "../../lib/utils";
import { Toast } from "../primitives/toast";
import type { AgentInfo, SpendingData } from "../types";
import { SpendingCategoryChart } from "../spending-category-chart";
import { NetworkFeesCard } from "../network-fees-card";
import type { CaregiverProfile, ConsentSettings } from "../../lib/types";
import { CostSplitSection } from "../cost-split-section";
import { EXPLORER_ACCOUNT_URL, NETWORK_LABEL } from "../../lib/stellar-network";
import { getTranslations, type Locale } from "../../i18n";
import { AGENT_URL } from "../../lib/agent-url";
import { agentFetch } from "../../lib/agent-fetch";
import { ContextualHelp } from "../primitives/contextual-help";

export interface WalletTabProps {
  agentInfo: AgentInfo | null;
  walletBalance: string | null;
  walletXlm: string | null;
  walletBalanceState?: 'loading' | 'ok' | 'error';
  walletBalanceError?: string | null;
  loadingWalletBalance?: boolean;
  onRetryWalletBalance?: () => void;
  loadingAgentInfo?: boolean;
  /** Spending summary; when present the tab shows the category breakdown (#1185). */
  spending?: SpendingData | null;
  loadingAgentInfo?: boolean;
  locale?: Locale;
  currentCaregiver?: CaregiverProfile;
  consentSettings?: ConsentSettings;
  recipientId?: string;
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
  spending,
  loadingAgentInfo = false,
  locale = "en",
  currentCaregiver,
  consentSettings,
  recipientId,
}: WalletTabProps) {
  const isRestricted =
    currentCaregiver &&
    currentCaregiver.role &&
    currentCaregiver.role !== "owner" &&
    consentSettings &&
    consentSettings[currentCaregiver.role]?.wallet === false;

  const t = getTranslations(locale);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [fundingModalOpen, setFundingModalOpen] = useState(false);

  if (isRestricted) {
    return (
      <div
        role="tabpanel"
        id="tabpanel-wallet"
        aria-labelledby="tab-wallet"
        tabIndex={0}
        className="space-y-6 max-w-2xl"
      >
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-xl mx-auto my-12">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">
            Wallet Access Restricted
          </h3>
          <p className="text-sm text-slate-600">
            The care recipient has configured consent settings that restrict viewing wallet and balance information for your caregiver role.
          </p>
        </div>
      </div>
    );
  }
  // --- Multisig State (Issue #1226) ---
  const [multisigConfig, setMultisigConfig] = useState<{
    enabled: boolean;
    thresholdAmount: number;
    coSigners: string[];
    timeWindowHours: number;
  }>({
    enabled: false,
    thresholdAmount: 100,
    coSigners: [],
    timeWindowHours: 48,
  });
  const [loadingMultisig, setLoadingMultisig] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [signingModalRequest, setSigningModalRequest] = useState<any | null>(null);
  const [signerKeyOrXdr, setSignerKeyOrXdr] = useState("");
  const [isSubmittingSig, setIsSubmittingSig] = useState(false);
  const [isConfiguringMultisig, setIsConfiguringMultisig] = useState(false);
  const [newCoSignerInput, setNewCoSignerInput] = useState("");

  const fetchMultisigData = async () => {
    try {
      setLoadingMultisig(true);
      const [cfgRes, reqRes] = await Promise.all([
        agentFetch(`${AGENT_URL}/agent/multisig/config?recipient_id=rosa`),
        agentFetch(`${AGENT_URL}/agent/multisig/pending?recipient_id=rosa`),
      ]);
      if (cfgRes.ok) {
        const cfg = await cfgRes.json();
        setMultisigConfig(cfg);
      }
      if (reqRes.ok) {
        const data = await reqRes.json();
        if (Array.isArray(data.requests)) {
          setPendingRequests(data.requests);
        }
      }
    } catch {
      // Fallback
    } finally {
      setLoadingMultisig(false);
    }
  };

  useEffect(() => {
    fetchMultisigData();
  }, []);

  const handleSaveMultisigConfig = async (patch: Partial<typeof multisigConfig>) => {
    const updated = { ...multisigConfig, ...patch };
    setMultisigConfig(updated);
    try {
      await agentFetch(`${AGENT_URL}/agent/multisig/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      setToastMsg("Multi-signature configuration updated");
    } catch {
      setToastMsg("Saved multi-signature configuration locally");
    }
  };

  const handleAuthorizeAndSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signingModalRequest || !signerKeyOrXdr.trim()) return;
    setIsSubmittingSig(true);
    try {
      const res = await agentFetch(`${AGENT_URL}/agent/multisig/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: signingModalRequest.id,
          signerSecretOrSignedXdr: signerKeyOrXdr.trim(),
          recipientId: "rosa",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setToastMsg(`Transaction signed & submitted to Stellar! Hash: ${data.txHash || "confirmed"}`);
        setSigningModalRequest(null);
        setSignerKeyOrXdr("");
        await fetchMultisigData();
      } else {
        setToastMsg(data.error || "Failed to authorize and sign transaction");
      }
    } catch (err: any) {
      setToastMsg(err?.message || "Network error submitting signature");
    } finally {
      setIsSubmittingSig(false);
    }
  };

  const handleRejectPayment = async (requestId: string) => {
    try {
      const res = await agentFetch(`${AGENT_URL}/agent/multisig/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          reason: "Caregiver declined payment",
          recipientId: "rosa",
        }),
      });
      if (res.ok) {
        setToastMsg("Multi-signature transaction rejected");
        await fetchMultisigData();
      }
    } catch {
      setToastMsg("Error rejecting transaction");
    }
  };

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

      {/* ── Co-Caregiver Signature Authorization Modal (Issue #1226) ── */}
      {signingModalRequest && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => {
              if (!isSubmittingSig) setSigningModalRequest(null);
            }}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-800">
                    Authorize Multi-Sig Transaction
                  </h3>
                  <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full uppercase">
                    Stellar 2-of-2
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSigningModalRequest(null)}
                  disabled={isSubmittingSig}
                  className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1 mb-4">
                <div className="flex justify-between font-medium text-slate-800">
                  <span>{signingModalRequest.description}</span>
                  <span className="font-mono text-slate-900">${signingModalRequest.amount.toFixed(2)} USDC</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Recipient: <span className="font-mono">{signingModalRequest.recipientId}</span> • Type: {signingModalRequest.type}
                </div>
                <div className="text-[11px] text-amber-700 font-medium">
                  Status: 1 of 2 signatures collected (CareGuard Agent key signed)
                </div>
              </div>

              <form onSubmit={handleAuthorizeAndSign} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Co-Caregiver Stellar Secret Key or Signed Envelope XDR *
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Enter co-signer secret key (S...) or paste pre-signed base64 transaction XDR"
                    value={signerKeyOrXdr}
                    onChange={(e) => setSignerKeyOrXdr(e.target.value)}
                    className="w-full text-xs font-mono p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    CareGuard attaches your cryptographic signature to the transaction envelope and submits to Horizon.
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSigningModalRequest(null)}
                    disabled={isSubmittingSig}
                    className="flex-1 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingSig || !signerKeyOrXdr.trim()}
                    className="flex-1 py-2 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                  >
                    {isSubmittingSig ? "Broadcasting to Stellar…" : "Co-Sign & Submit"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {/* ── Multi-Signature Shared Financial Custody Card (Issue #1226) ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Shared Custody & Multi-Signature Wallet
              </h2>
              <ContextualHelp topicKey="multisig_authorization" caregiverId="caregiver" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Require co-caregiver cryptographic signatures on large payments before submitting to Stellar
            </p>
          </div>
          <button
            onClick={() => setIsConfiguringMultisig(!isConfiguringMultisig)}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium cursor-pointer transition-all"
          >
            {isConfiguringMultisig ? "Close Settings" : "Configure Multi-Sig"}
          </button>
        </div>

        {/* Configuration Panel */}
        {isConfiguringMultisig && (
          <div className="mb-5 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-800">
                  Enable Multi-Signature Requirement
                </span>
                <p className="text-[11px] text-slate-500">
                  When disabled, payments execute autonomously under single-signer policy checks.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={multisigConfig.enabled}
                  onChange={(e) => handleSaveMultisigConfig({ enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Threshold Amount ($ USDC)
                </label>
                <input
                  type="number"
                  min={1}
                  value={multisigConfig.thresholdAmount}
                  onChange={(e) =>
                    handleSaveMultisigConfig({
                      thresholdAmount: Math.max(1, parseFloat(e.target.value) || 1),
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Payments above this amount require co-signature
                </p>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  Signature Collection Window (Hours)
                </label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={multisigConfig.timeWindowHours}
                  onChange={(e) =>
                    handleSaveMultisigConfig({
                      timeWindowHours: Math.max(1, parseInt(e.target.value, 10) || 24),
                    })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Time window before unsigned payment requests expire
                </p>
              </div>
            </div>

            <div>
              <label className="block text-slate-700 font-medium text-xs mb-1">
                Authorized Co-Caregiver Signers (Stellar Public Keys)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter G... Stellar public key"
                  value={newCoSignerInput}
                  onChange={(e) => setNewCoSignerInput(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <button
                  type="button"
                  onClick={() => {
                    const key = newCoSignerInput.trim();
                    if (!key.startsWith("G") || key.length !== 56) {
                      setToastMsg("Please enter a valid 56-character Stellar public key (starting with G)");
                      return;
                    }
                    if (multisigConfig.coSigners.includes(key)) {
                      setToastMsg("Signer already added");
                      return;
                    }
                    const updatedSigners = [...multisigConfig.coSigners, key];
                    handleSaveMultisigConfig({ coSigners: updatedSigners });
                    setNewCoSignerInput("");
                  }}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 cursor-pointer"
                >
                  Add Signer
                </button>
              </div>

              {multisigConfig.coSigners.length > 0 && (
                <div className="mt-2 space-y-1">
                  {multisigConfig.coSigners.map((signer) => (
                    <div
                      key={signer}
                      className="flex items-center justify-between p-2 bg-white rounded border border-slate-200 text-xs font-mono"
                    >
                      <span className="truncate">{truncateAddress(signer)} ({signer})</span>
                      <button
                        type="button"
                        onClick={() => {
                          const updated = multisigConfig.coSigners.filter((s) => s !== signer);
                          handleSaveMultisigConfig({ coSigners: updated });
                        }}
                        className="text-slate-400 hover:text-red-600 text-xs px-2 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Current State Summary */}
        <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-100 text-xs mb-4">
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                multisigConfig.enabled ? "bg-purple-600 animate-pulse" : "bg-slate-400"
              }`}
            />
            <span className="font-semibold text-slate-800">
              {multisigConfig.enabled ? "Multi-Signature Custody Active" : "Single-Signer Mode (Default)"}
            </span>
          </div>
          <span className="text-slate-500 font-mono">
            {multisigConfig.enabled
              ? `Threshold: >$${multisigConfig.thresholdAmount.toFixed(2)} • ${multisigConfig.coSigners.length} Co-Signer(s)`
              : "All amounts execute via agent key"}
          </span>
        </div>

        {/* Pending Signature Requests Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Pending Co-Signer Authorizations ({pendingRequests.length})
            </h3>
            <button
              onClick={fetchMultisigData}
              className="text-xs text-sky-600 hover:text-sky-800 cursor-pointer"
            >
              Refresh ↻
            </button>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400 bg-slate-50 rounded-lg">
              No transactions pending co-signature. Payments exceeding ${multisigConfig.thresholdAmount.toFixed(2)} will appear here for secondary review.
            </div>
          ) : (
            <div className="space-y-3">
              {pendingRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 bg-purple-50/50 rounded-xl border border-purple-200 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-900">
                        {req.description}
                      </div>
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        Amount: <strong className="text-slate-800 font-mono">${req.amount.toFixed(2)} USDC</strong> • Category: {req.type}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                      Awaiting 2nd Signature
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-purple-100">
                    <span>
                      Expires: {new Date(req.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(req.expiresAt).toLocaleDateString()})
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRejectPayment(req.id)}
                        className="px-2.5 py-1 text-slate-600 hover:text-red-700 bg-white border border-slate-200 rounded font-medium cursor-pointer transition-colors"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() => {
                          setSigningModalRequest(req);
                          setSignerKeyOrXdr("");
                        }}
                        className="px-3 py-1 bg-purple-600 text-white hover:bg-purple-700 rounded font-medium cursor-pointer transition-colors"
                      >
                        Authorize & Sign
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {spending && <SpendingCategoryChart spending={spending} locale={locale} />}
      {spending && <NetworkFeesCard spending={spending} locale={locale} />}

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

      <CostSplitSection
        recipientId={recipientId || "rosa"}
        currentCaregiverName={currentCaregiver?.name}
        currentCaregiverId={currentCaregiver?.id}
      />
    </div>
  );
}
