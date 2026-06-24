"use client";

import type { RecipientProfile } from "../lib/types";
import type { AgentInfo } from "./types";

export interface DashboardHeaderProps {
  recipient: RecipientProfile;
  recipientInitials: string;
  agentInfo: AgentInfo | null;
  agentConnected: boolean;
  agentPaused: boolean;
  walletBalance: string | null;
  onTogglePause: () => void;
}

export function DashboardHeader({
  recipient,
  recipientInitials,
  agentInfo,
  agentConnected,
  agentPaused,
  walletBalance,
  onTogglePause,
}: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-sm font-bold text-white">
                CG
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-semibold leading-tight">
                  CareGuard
                </h1>
                <p className="text-xs text-slate-500">
                  AI Healthcare Agent on Stellar
                </p>
              </div>
            </div>
            <div
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium ${agentConnected ? (agentPaused ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700") : "bg-red-50 text-red-600"}`}
            >
              <div
                className={`h-1.5 w-1.5 rounded-full ${agentConnected ? (agentPaused ? "bg-amber-500" : "bg-green-500") : "bg-red-500"}`}
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
                className={`inline-flex min-h-11 items-center justify-center rounded-full px-4 py-2.5 text-xs font-medium transition-all cursor-pointer ${agentPaused ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-amber-100 text-amber-700 hover:bg-amber-200"}`}
              >
                {agentPaused ? "Resume" : "Pause"}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
            {walletBalance && agentInfo?.agentWallet && (
              <a
                href={`https://stellar.expert/explorer/testnet/account/${agentInfo.agentWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left sm:text-right"
              >
                <div className="text-xs text-slate-500">Agent Wallet (USDC)</div>
                <div className="text-sm font-semibold group-hover:text-sky-600">
                  ${walletBalance}
                </div>
              </a>
            )}
            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div className="text-left text-xs sm:text-right">
                <div className="text-slate-500">Care Recipient</div>
                <div className="break-words font-medium">
                  {recipient.name}
                  {typeof recipient.age === "number" ? `, ${recipient.age}` : ""}
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-medium text-amber-700">
                {recipientInitials}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
