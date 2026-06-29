"use client";

import { useState } from "react";
import type { RecipientProfile } from "../lib/types";
import type { AgentInfo } from "./types";
import { EXPLORER_ACCOUNT_URL } from "../lib/stellar-network";

export interface RecipientOption {
  id: string;
  name: string;
}

export interface DashboardHeaderProps {
  recipient: RecipientProfile;
  recipientInitials: string;
  agentInfo: AgentInfo | null;
  agentConnected: boolean;
  agentPaused: boolean;
  walletBalance: string | null;
  onTogglePause: () => void;
  recipients?: RecipientOption[];
  selectedRecipientId?: string;
  onSelectRecipient?: (id: string) => void;
  // per-source health (Issue #213)
  agentInfoError?: string | null;
  spendingError?: string | null;
  transactionsError?: string | null;
}

export function DashboardHeader({
  recipient,
  recipientInitials,
  agentInfo,
  agentConnected,
  agentPaused,
  walletBalance,
  onTogglePause,
  recipients,
  selectedRecipientId,
  onSelectRecipient,
  agentInfoError,
  spendingError,
  transactionsError,
}: DashboardHeaderProps) {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const sourceErrors: { source: string; error: string }[] = [
    ...(agentInfoError ? [{ source: 'Agent', error: agentInfoError }] : []),
    ...(spendingError ? [{ source: 'Spending', error: spendingError }] : []),
    ...(transactionsError ? [{ source: 'Transactions', error: transactionsError }] : []),
  ];
  const anySourceDown = sourceErrors.length > 0;
  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-500 flex items-center justify-center text-white font-bold text-sm">
            CG
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">CareGuard</h1>
            <p className="text-xs text-slate-500">
              AI Healthcare Agent on Stellar
            </p>
          </div>
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${agentConnected ? (agentPaused ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700") : "bg-red-50 text-red-600"}`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${agentConnected ? (agentPaused ? "bg-amber-500" : "bg-green-500") : "bg-red-500"}`}
            />
            {!agentConnected
              ? "Disconnected"
              : agentPaused
                ? "Paused"
                : "Active"}
          </div>
          {agentConnected && (
            <button
              onClick={onTogglePause}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${agentPaused ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
            >
              {agentPaused ? "Resume" : "Pause"}
            </button>
          )}
          {anySourceDown && (
            <div className="relative">
              <button
                data-testid="source-health-chip"
                onMouseEnter={() => setTooltipVisible(true)}
                onMouseLeave={() => setTooltipVisible(false)}
                onFocus={() => setTooltipVisible(true)}
                onBlur={() => setTooltipVisible(false)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-red-50 text-red-600 cursor-default"
                aria-label={`Data source issues: ${sourceErrors.map((e) => e.source).join(', ')}`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Data issue
              </button>
              {tooltipVisible && (
                <div
                  role="tooltip"
                  className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg bg-slate-900 text-white text-xs p-3 shadow-lg"
                >
                  <p className="font-semibold mb-1">Sources failing:</p>
                  <ul className="space-y-1">
                    {sourceErrors.map(({ source, error }) => (
                      <li key={source}>
                        <span className="font-medium">{source}:</span> {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4">
          {walletBalance && agentInfo?.agentWallet && (
            <a
              href={`${EXPLORER_ACCOUNT_URL}/${agentInfo.agentWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-right group"
            >
              <div className="text-xs text-slate-500">Agent Wallet (USDC)</div>
              <div className="font-semibold text-sm group-hover:text-sky-600">
                ${walletBalance}
              </div>
            </a>
          )}
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className="text-right text-xs">
              <div className="text-slate-500">Care Recipient</div>
              {recipients && recipients.length > 1 && onSelectRecipient ? (
                <select
                  className="font-medium bg-transparent border-none outline-none cursor-pointer text-xs"
                  value={selectedRecipientId ?? ''}
                  onChange={(e) => onSelectRecipient(e.target.value)}
                  aria-label="Select care recipient"
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              ) : (
                <div className="font-medium">
                  {recipient.name}
                  {typeof recipient.age === "number" ? `, ${recipient.age}` : ""}
                </div>
              )}
            </div>
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-sm font-medium">
              {recipientInitials}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
