"use client";

import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { Toast } from "../primitives/toast";
import type { AgentInfo } from "../types";

export interface WalletTabProps {
  agentInfo: AgentInfo | null;
  walletBalance: string | null;
  walletXlm: string | null;
}

export function WalletTab({ agentInfo, walletBalance, walletXlm }: WalletTabProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);

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
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Wallet</h2>
        <p className="text-xs text-slate-500 mb-4">
          This is the AI agent&apos;s Stellar wallet. It holds USDC for paying
          pharmacies, medical bills, and API query fees. All balances are on
          Stellar testnet.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-sky-50 rounded-lg p-4 text-center border border-sky-200">
            <div className="text-2xl font-bold text-sky-700">
              ${walletBalance || "0.00"}
            </div>
            <div className="text-xs text-slate-500 mt-1">USDC Balance</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4 text-center border border-slate-200">
            <div className="text-2xl font-bold text-slate-700">
              {walletXlm || "0.00"}
            </div>
            <div className="text-xs text-slate-500 mt-1">XLM Balance</div>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Wallet Address
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono break-all">
                {agentInfo?.agentWallet || "Not connected"}
              </code>
              {agentInfo?.agentWallet && (
                <button
                  onClick={() =>
                    handleCopy(agentInfo.agentWallet, "wallet-address")
                  }
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    copiedId === "wallet-address"
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
              Network
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              Stellar Testnet
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              LLM Provider
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              {agentInfo?.llm || "Not connected"}
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          {agentInfo?.agentWallet && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${agentInfo.agentWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 text-center px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 active:bg-sky-700 cursor-pointer transition-all"
            >
              View on Stellar Explorer
            </a>
          )}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-center px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 active:bg-slate-300 cursor-pointer transition-all"
          >
            Fund with USDC
          </a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          How Payments Work
        </h2>
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
