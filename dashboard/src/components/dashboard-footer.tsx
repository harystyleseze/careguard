"use client";

export interface DashboardFooterProps {
  agentWallet?: string;
}

export function DashboardFooter({ agentWallet }: DashboardFooterProps) {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-3">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-xs text-slate-400">
        <span>CareGuard | Stellar Testnet | x402 + MPP</span>
        <div className="flex items-center gap-3">
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
