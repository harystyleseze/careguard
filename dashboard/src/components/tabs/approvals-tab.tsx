"use client";

import { useEffect, useState } from "react";
import type { Transaction } from "../types";
import { formatDateTime, type Locale, getTranslations } from "../../i18n";
import { AGENT_URL } from "../../lib/agent-url";
import { agentFetch } from "../../lib/agent-fetch";
import type { ItemPresenceMap, CaregiverProfile } from "../../lib/types";
import { ProfileChangeApprovals } from "../profile-change-approvals";

/** Who is deciding, and whose authority they use when delegated (#1195). */
export interface ApprovalActor {
  caregiverId: string;
  onBehalfOf: string;
}

/** Active delegation held by the current caregiver, as returned by GET /agent/delegations. */
interface ActiveDelegation {
  id: string;
  delegator: string;
  ends_at: string;
}

export interface ApprovalsTabProps {
  agentConnected: boolean;
  approvals: Transaction[];
  loading: boolean;
  onApprove: (txId: string, actor?: ApprovalActor) => Promise<void>;
  onCancel: (txId: string, actor?: ApprovalActor) => Promise<void>;
  locale?: Locale;
  currentCaregiver?: CaregiverProfile;
  linkedCaregivers?: CaregiverProfile[];
}

function formatTimeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ApprovalsTab({
  agentConnected,
  approvals,
  loading,
  onApprove,
  onCancel,
  locale = "en",
  currentCaregiver = { name: "Maria Garcia", relationship: "Primary Caregiver" },
  linkedCaregivers = [
    { name: "Maria Garcia", relationship: "Primary Caregiver" },
    { name: "David Garcia", relationship: "Secondary Caregiver" },
  ],
}: ApprovalsTabProps) {
  const [, setTick] = useState(0);
  const [presenceMap, setPresenceMap] = useState<ItemPresenceMap>({});
  const [delegation, setDelegation] = useState<ActiveDelegation | null>(null);
  const t = getTranslations(locale);
  const caregiverId = currentCaregiver.name.toLowerCase().replace(/\s+/g, "-");

  // Delegated approval authority held by this caregiver (#1195). Re-checked
  // every minute so the banner disappears when the window ends or is revoked.
  useEffect(() => {
    if (!agentConnected) return;
    let cancelled = false;
    async function fetchDelegation() {
      try {
        const res = await agentFetch(
          `${AGENT_URL}/agent/delegations?recipient_id=rosa&delegate=${encodeURIComponent(caregiverId)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setDelegation(data.delegations?.[0] ?? null);
      } catch {
        // Non-blocking: without it the caregiver simply acts as themselves.
      }
    }
    fetchDelegation();
    const timer = setInterval(fetchDelegation, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agentConnected, caregiverId]);

  const activeDelegation =
    delegation && Date.parse(delegation.ends_at) > Date.now() ? delegation : null;
  const actor: ApprovalActor | undefined = activeDelegation
    ? { caregiverId, onBehalfOf: activeDelegation.delegator }
    : undefined;

  useEffect(() => {
    const timer = setInterval(() => setTick((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Co-caregiver presence tracking (Issue #1231)
  useEffect(() => {
    async function trackAndFetchPresence() {
      // 1. Record view for each approval
      for (const tx of approvals) {
        try {
          await agentFetch(`${AGENT_URL}/agent/presence/view`, {
            method: "POST",
            body: JSON.stringify({
              itemId: tx.id,
              itemType: "approval",
              caregiverId,
              caregiverName: currentCaregiver.name,
              recipientId: "rosa",
            }),
          });
        } catch {
          // Non-blocking ephemeral presence
        }
      }

      // 2. Fetch active presence map
      try {
        const res = await agentFetch(`${AGENT_URL}/agent/presence?recipient_id=rosa`);
        if (res.ok) {
          const data = await res.json();
          if (data.presence) {
            setPresenceMap(data.presence);
          }
        }
      } catch {
        // Non-blocking
      }
    }

    if (approvals.length > 0) {
      trackAndFetchPresence();
    }
  }, [approvals, currentCaregiver.name]);

  const hasMultipleCaregivers = (linkedCaregivers?.length ?? 0) > 1;

  return (
    <div
      role="tabpanel"
      id="tabpanel-approvals"
      aria-labelledby="tab-approvals"
      tabIndex={0}
      className="space-y-6"
    >
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">
            {t.approvals.pending}
          </h2>
          {hasMultipleCaregivers && (
            <span className="text-[11px] text-slate-400">
              Co-caregivers active: {linkedCaregivers.map((c) => c.name).join(", ")}
            </span>
          )}
        </div>

        {activeDelegation && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900"
          >
            <span className="font-semibold">Delegated approval:</span> you&apos;re acting on behalf of{" "}
            <span className="font-medium">{activeDelegation.delegator}</span> until{" "}
            {formatDateTime(new Date(activeDelegation.ends_at), locale)}. Your decisions are recorded
            as delegated in the audit log.
          </div>
        )}

        {!agentConnected && (
          <p className="text-xs text-slate-500">Agent not connected.</p>
        )}
        {agentConnected && approvals.length === 0 && (
          <div>
            <p className="text-xs text-slate-500 mb-2">{t.approvals.noPending}</p>
            <p className="text-xs text-slate-400">{t.approvals.noPendingReassurance}</p>
          </div>
        )}
        {approvals.length > 0 && (
          <div className="space-y-3">
            {approvals.map((tx) => {
              // Find if another caregiver viewed this item
              const coViewers = hasMultipleCaregivers
                ? (presenceMap[tx.id] || []).filter(
                    (e) => e.caregiverName !== currentCaregiver.name,
                  )
                : [];
              const latestCoViewer = coViewers[coViewers.length - 1];
              const isExceptionRequest = Boolean((tx as any).type === "exception" || (tx as any).reason);

              return (
                <div
                  key={tx.id}
                  className="border border-amber-200 bg-amber-50 rounded-lg p-4"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">
                          {tx.description}
                        </span>
                        {/* Co-caregiver presence badge (Issue #1231) */}
                        {latestCoViewer && (
                          <span
                            title={`Viewed by ${latestCoViewer.caregiverName} at ${new Date(
                              latestCoViewer.lastViewedAt,
                            ).toLocaleTimeString()}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-100 text-sky-800 border border-sky-200"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                            Viewed by {latestCoViewer.caregiverName}{" "}
                            {formatTimeAgo(latestCoViewer.lastViewedAt)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        {isExceptionRequest ? (
                          <span>Request exception • Amount: ${tx.amount.toFixed(2)} | Category: {tx.category}</span>
                        ) : (
                          <span>Amount: ${tx.amount.toFixed(2)} | Category: {tx.category}</span>
                        )}
                      </div>
                      {isExceptionRequest && (
                        <div className="text-xs text-amber-700 mt-1 font-medium">
                          {(tx as any).reason || "Unexpected specialist bill requires caregiver approval."}
                        </div>
                      )}
                      <div className="text-xs text-slate-400 mt-1">
                        {formatDateTime(new Date(tx.timestamp), locale)}
                      </div>
                      {tx.pendingUntil && (
                        (() => {
                          try {
                            const ms = new Date(tx.pendingUntil).getTime() - Date.now();
                            const sec = Math.max(0, Math.ceil(ms / 1000));
                            const announcedSec = sec <= 5 ? sec : Math.ceil(sec / 10) * 10;
                            const totalTimeMs =
                              new Date(tx.pendingUntil).getTime() -
                              new Date(tx.timestamp).getTime();
                            const elapsedMs = totalTimeMs - ms;
                            const progressPercent = Math.min(
                              100,
                              Math.max(0, (elapsedMs / totalTimeMs) * 100),
                            );

                            return (
                              <div className="mt-3">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs text-amber-600 font-medium">
                                    {sec > 0
                                      ? t.approvals.autoApproveCountdown.replace(
                                          "{seconds}",
                                          String(sec),
                                        )
                                      : t.approvals.countdownExpired}
                                  </span>
                                </div>
                                <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-amber-500 transition-all"
                                    style={{ width: `${progressPercent}%` }}
                                  />
                                </div>
                                <span className="sr-only" aria-live="polite">
                                  Auto-approve in {announcedSec} seconds
                                </span>
                              </div>
                            );
                          } catch {
                            return null;
                          }
                        })()
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => (actor ? onApprove(tx.id, actor) : onApprove(tx.id))}
                        disabled={loading}
                        className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                      >
                        {isExceptionRequest ? "Approve exception" : "Approve"}
                      </button>
                      <button
                        onClick={() => (actor ? onCancel(tx.id, actor) : onCancel(tx.id))}
                        disabled={loading}
                        className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                      >
                        {isExceptionRequest ? "Deny exception" : "Cancel"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProfileChangeApprovals
        agentConnected={agentConnected}
        caregiverId={caregiverId}
        // Profiles without a role predate multi-caregiver access: the single
        // caregiver is the owner. The agent re-checks this on every decision.
        isOwner={((currentCaregiver as { role?: string }).role ?? "owner") === "owner"}
        locale={locale}
      />

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">
          How Approvals Work
        </h2>
        <div className="space-y-2 text-xs text-slate-600">
          <p>
            When the AI agent encounters a payment above the approval threshold
            (${" "}
            <code className="bg-slate-100 px-1 rounded">approvalThreshold</code>),
            it creates a pending transaction instead of paying immediately.
          </p>
          <p>
            You can review and approve or cancel each pending transaction here.
            Approving will execute the payment; canceling will stop it.
          </p>
          <p>
            Sensitive profile changes — raising a spending limit, removing a
            co-caregiver, or changing wallet auto-topup — also wait here until a
            caregiver with the owner role approves them.
          </p>
        </div>
      </div>
    </div>
  );
}
