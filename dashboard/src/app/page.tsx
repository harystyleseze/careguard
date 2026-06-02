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
import { agentUrlConfig } from "../lib/agent-url";
import { useProfile } from "../lib/useProfile";

function AgentConfigurationError({ message }: { message: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="max-w-2xl rounded-2xl border border-red-500/40 bg-red-950/30 p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-300">
          Configuration required
        </p>
        <h1 className="mt-3 text-3xl font-bold">CareGuard API URL is not configured</h1>
        <p className="mt-4 text-slate-200">{message}</p>
        <p className="mt-4 rounded-lg bg-slate-900 p-4 font-mono text-sm text-slate-100">
          NEXT_PUBLIC_API_URL=https://your-careguard-api.example.com
        </p>
        <p className="mt-4 text-sm text-slate-300">
          Local development still falls back to http://localhost:3004, but production builds must set the deployed API URL explicitly.
        </p>
      </section>
    </main>
  );
}

export default function Dashboard() {
  if (agentUrlConfig.missingRequiredEnv) {
    return <AgentConfigurationError message={agentUrlConfig.message} />;
  }

  return <DashboardContent agentUrl={agentUrlConfig.agentUrl} />;
}

function DashboardContent({ agentUrl }: { agentUrl: string }) {
  const { recipient, caregiver, updateProfile } = useProfile();
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

  const state = useAgentState({ activeTab, agentUrl });

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
    <div className="min-h-screen">
      <LiveRegion message={state.liveMessage} />
      <LowBalanceBanner
        pausedReason={state.agentPausedReason}
        walletBalance={state.walletBalance}
        walletXlm={state.walletXlm}
        onResume={state.togglePause}
      />
      <DashboardHeader
        recipient={recipient}
        recipientInitials={recipientInitials}
        agentInfo={state.agentInfo}
        agentConnected={state.agentConnected}
        agentPaused={state.agentPaused}
        walletBalance={state.walletBalance}
        onTogglePause={state.togglePause}
      />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <DashboardTabsNav activeTab={activeTab} pathname={pathname} />
        {activeTab === "overview" && (
          <OverviewTab
            spending={state.spending}
            agentResult={state.agentResult}
            agentPaused={state.agentPaused}
            loading={state.loading}
            activeTask={state.activeTask}
            onRunTask={state.runAgentTask}
            recipient={recipient}
          />
        )}
        {activeTab === "medications" && (
          <MedicationsTab agentResult={state.agentResult} recipient={recipient} />
        )}
        {activeTab === "bills" && (
          <BillsTab agentResult={state.agentResult} recipient={recipient} caregiverName={caregiver.name} />
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
