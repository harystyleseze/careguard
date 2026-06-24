"use client";

export interface DashboardFooterProps {
  agentWallet?: string;
}

export function DashboardFooter({ agentWallet }: DashboardFooterProps) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-3">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <span>CareGuard | Stellar Testnet | x402 + MPP</span>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          {agentWallet && (
            <a
              href={`https://stellar.expert/explorer/testnet/account/${agentWallet}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-500 hover:text-sky-700 underline"
            >
              Agent Wallet on Explorer
            </a>
          )}
          <span>Careguard Agent 2026</span>
        </div>
      </div>
    </footer>
  );
}
