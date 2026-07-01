"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardFooter } from "../components/dashboard-footer";
import { DashboardHeader } from "../components/dashboard-header";
import { DashboardTabsNav } from "../components/dashboard-tabs-nav";
import { LowBalanceBanner } from "../components/low-balance-banner";
import { LiveRegion } from "../components/primitives/live-region";
import { ActivityTab } from "../components/tabs/activity-tab";
import { BillsTab } from "../components/tabs/bills-tab";
import { MedicationsTab } from "../components/tabs/medications-tab";
import { OverviewTab } from "../components/tabs/overview-tab";
import { ApprovalsTab } from "../components/tabs/approvals-tab";
import { PolicyTab } from "../components/tabs/policy-tab";
import { SettingsTab } from "../components/tabs/settings-tab";
import { WalletTab } from "../components/tabs/wallet-tab";
import { DASHBOARD_TABS, type Tab } from "../components/types";
import { useAgentState } from "../hooks/use-agent-state";
import { useProfile } from "../lib/useProfile";
import { useRecipients } from "../lib/useRecipients";
import { ConfigErrorPage } from "../components/config-error-page";
import { AGENT_URL } from "../lib/agent-url";


export default function Dashboard() {
  // In production, AGENT_URL is null when NEXT_PUBLIC_API_URL is unset.
  // Show a configuration error page rather than a confusing connection failure
  // to localhost (#222).
  if (AGENT_URL === null) {
    return <ConfigErrorPage />;
  }

  const { recipient, caregiver, updateProfile } = useProfile();
  const { recipients, selectedId, selectRecipient } = useRecipients((profile) => {
    updateProfile({ recipient: profile });
  });
  const pathname = usePathname();
  const searchParams = useSearchParams();


  const recipientInitials = recipient.name
    .split(" ")
    .map((c) => c[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const activeTab = useMemo<Tab>(() => {
    const tab = searchParams.get("tab");
    return (DASHBOARD_TABS as readonly string[]).includes(tab || "")
      ? (tab as Tab)
      : "overview";
  }, [searchParams]);

  const state = useAgentState({ activeTab });

  const ariaLogRef = useRef<number | null>(null);
  const [debouncedAriaLog, setDebouncedAriaLog] = useState<string[]>([]);
  useEffect(() => {
    if (ariaLogRef.current) window.clearTimeout(ariaLogRef.current);
    ariaLogRef.current = window.setTimeout(() => {
      setDebouncedAriaLog(state.agentLog.slice(-20).map((e) => e.message));
    }, 800);
    return () => {
      if (ariaLogRef.current) window.clearTimeout(ariaLogRef.current);
    };
  }, [state.agentLog]);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <LiveRegion message={state.liveMessage} />
      <LowBalanceBanner
        pausedReason={state.agentPausedReason}
        walletBalance={state.walletBalance}
        walletXlm={state.walletXlm}
        onResume={state.togglePause}
      />
      {state.agentResult?.truncated && (
        <div
          role="alert"
          className="mx-auto max-w-7xl px-4 pt-4"
        >
          <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-sm text-yellow-800">
            The last agent task was truncated — the result may be incomplete. Consider re-running with a more focused request.
          </div>
        </div>
      )}
      <DashboardHeader
        recipient={recipient}
        recipientInitials={recipientInitials}
        agentInfo={state.agentInfo}
        agentConnected={state.agentConnected}
        agentPaused={state.agentPaused}
        walletBalance={state.walletBalance}
        onTogglePause={state.togglePause}
        recipients={recipients}
        selectedRecipientId={selectedId}
        onSelectRecipient={selectRecipient}
        agentInfoError={state.agentInfoError}
        spendingError={state.spendingError}
        transactionsError={state.transactionsError}
      />
      <div className="max-w-7xl mx-auto px-4 py-6 overflow-x-hidden">
        <DashboardTabsNav activeTab={activeTab} pathname={pathname} />
        {activeTab === "overview" && (
          <OverviewTab
            spending={state.spending}
            agentResult={state.agentResult}
            agentPaused={state.agentPaused}
            loading={state.loading}
            activeTask={state.activeTask}
            onRunTask={state.runAgentTask}
            onCancelTask={state.cancelAgentTask}
            recipient={recipient}
          />
        )}
        {activeTab === "medications" && (
          <MedicationsTab
            agentResult={state.agentResult}
            recipient={recipient}
          />
        )}
        {activeTab === "bills" && (
          <BillsTab
            agentResult={state.agentResult}
            recipient={recipient}
          />
        )}
        {activeTab === "approvals" && (
          <ApprovalsTab agentConnected={state.agentConnected} />
        )}
        {activeTab === "policy" && (
          <PolicyTab
            recipient={recipient}
            policyForm={state.policyForm}
            setPolicyForm={state.setPolicyForm}
            setPolicyDirty={state.setPolicyDirty}
            spending={state.spending}
            policySaved={state.policySaved}
            onUpdatePolicy={state.updatePolicy}
            onForceSync={() => state.fetchSpending({ forcePolicySync: true })}
          />
        )}
        {activeTab === "wallet" && (
          <WalletTab
            agentInfo={state.agentInfo}
            walletBalance={state.walletBalance}
            walletXlm={state.walletXlm}
            walletBalanceState={state.walletBalanceState}
            walletBalanceError={state.walletBalanceError}
            loadingWalletBalance={state.loadingWalletBalance}
            onRetryWalletBalance={state.retryWalletBalance}
            loadingAgentInfo={state.loadingAgentInfo}
          />
        )}
        {activeTab === "activity" && (
          <ActivityTab
            recipient={recipient}
            agentLog={state.agentLog}
            setAgentLog={state.setAgentLog}
            allTransactions={state.allTransactions}
            auditEvents={state.auditEvents}
            pagination={state.pagination}
            currentPage={state.currentPage}
            setCurrentPage={state.setCurrentPage}
            pageSize={state.pageSize}
            setPageSize={state.setPageSize}
            spending={state.spending}
            onResetAgent={state.resetAgent}
            loadingTransactions={state.loadingTransactions}
            loadingSpending={state.loadingSpending}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            recipient={recipient}
            caregiver={caregiver}
            agentInfo={state.agentInfo}
            agentPaused={state.agentPaused}
            onTogglePause={state.togglePause}
            onUpdateProfile={updateProfile}
            recipients={recipients}
            selectedRecipientId={selectedId}
            onSelectRecipient={selectRecipient}
          />
        )}
      </div>
      <DashboardFooter agentWallet={state.agentInfo?.agentWallet} />
      <span className="sr-only" aria-hidden="true">
        {debouncedAriaLog.join("\n")}
      </span>
    </div>
  );
}
