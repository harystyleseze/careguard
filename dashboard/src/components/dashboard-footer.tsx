"use client";

import { EXPLORER_ACCOUNT_URL, NETWORK_LABEL } from "../lib/stellar-network";
import { getTranslations, type Locale } from "../i18n";

export interface DashboardFooterProps {
  agentWallet?: string;
  locale?: Locale;
}

export function DashboardFooter({ agentWallet, locale = "en" }: DashboardFooterProps) {
  const t = getTranslations(locale);
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white py-3">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between text-xs text-slate-400">
        <span>{t.app.title} | {NETWORK_LABEL} | x402 + MPP</span>
        <div className="flex items-center gap-3">
          {agentWallet && (
            <>
              <a
                href={`${EXPLORER_ACCOUNT_URL}/${agentWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-500 hover:text-sky-700 underline"
                title="View public transaction record on blockchain explorer"
              >
                {t.wallet.viewExplorer}
              </a>
            </>
          )}
          <span suppressHydrationWarning>
            {t.app.title} Agent {new Date().getFullYear()}
          </span>
        </div>
      </div>
    </footer>
  );
}
