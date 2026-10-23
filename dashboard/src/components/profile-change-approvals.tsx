"use client";

import { useCallback, useEffect, useState } from "react";
import { agentFetch } from "../lib/agent-fetch";
import { formatDateTime, type Locale } from "../i18n";

interface ProfileChangeDetail {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
}

export interface ProfileChangeRequest {
  id: string;
  recipient_id: string;
  kind: "policy_limit_increase" | "caregiver_removal" | "auto_topup_change";
  summary: string;
  changes: ProfileChangeDetail[];
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
}

const KIND_LABELS: Record<ProfileChangeRequest["kind"], string> = {
  policy_limit_increase: "Spending limit increase",
  caregiver_removal: "Caregiver removal",
  auto_topup_change: "Wallet auto-topup change",
};

const MONEY_FIELDS = new Set([
  "dailyLimit",
  "monthlyLimit",
  "medicationMonthlyBudget",
  "billMonthlyBudget",
  "approvalThreshold",
  "threshold",
  "topUpAmount",
]);

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (MONEY_FIELDS.has(field) && Number.isFinite(Number(value))) return `$${Number(value).toFixed(2)}`;
  return String(value);
}

/**
 * Sensitive profile changes awaiting owner approval (#1233): raised spending
 * limits, caregiver removals and wallet auto-topup changes. Only a caregiver
 * with the owner role can decide; the agent enforces this too.
 */
export function ProfileChangeApprovals({
  agentConnected,
  recipientId = "rosa",
  caregiverId,
  isOwner,
  locale = "en",
}: {
  agentConnected: boolean;
  recipientId?: string;
  caregiverId: string;
  isOwner: boolean;
  locale?: Locale;
}) {
  const [requests, setRequests] = useState<ProfileChangeRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await agentFetch(
        `/agent/profile-changes?recipient_id=${encodeURIComponent(recipientId)}&status=pending`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch {
      // Non-blocking: transaction approvals still work without this list.
    }
  }, [recipientId]);

  useEffect(() => {
    if (!agentConnected) return;
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [agentConnected, load]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await agentFetch(`/agent/profile-changes/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caregiver_id: caregiverId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Couldn't ${action} this change`);
        return;
      }
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError(`Couldn't ${action} this change — the agent may be offline.`);
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6" data-testid="profile-change-approvals">
      <h2 className="text-sm font-semibold text-slate-700">Profile changes awaiting approval</h2>
      <p className="text-xs text-slate-500 mt-1 mb-4">
        These changes loosen spending controls or caregiver access, so they don&apos;t apply until an owner approves
        them. Every decision is recorded in the audit log.
      </p>
      {!isOwner && (
        <p role="note" className="mb-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Only a caregiver with the owner role can approve or reject these changes.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-3 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="space-y-3">
        {requests.map((req) => (
          <div key={req.id} className="border border-violet-200 bg-violet-50 rounded-lg p-4">
            <div className="flex flex-wrap justify-between items-start gap-3">
              <div>
                <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-violet-100 text-violet-800">
                  {KIND_LABELS[req.kind] ?? req.kind}
                </span>
                <p className="text-sm font-medium text-slate-700 mt-2">{req.summary}</p>
                {req.changes.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {req.changes.map((c) => (
                      <li key={c.field}>
                        {c.label}: {formatValue(c.field, c.before)} → {formatValue(c.field, c.after)}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  Requested by {req.requested_by} · {formatDateTime(new Date(req.requested_at), locale)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => decide(req.id, "approve")}
                  disabled={!isOwner || busyId === req.id}
                  className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 cursor-pointer"
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(req.id, "reject")}
                  disabled={!isOwner || busyId === req.id}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
