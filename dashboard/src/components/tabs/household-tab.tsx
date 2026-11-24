"use client";

import { useEffect, useState } from "react";
import { agentFetch } from "../../lib/agent-fetch";
import type { RecipientListItem } from "../../lib/useRecipients";

export interface HouseholdTabProps {
  recipients: RecipientListItem[];
  selectedRecipientId: string;
  onSelectRecipient: (id: string) => void;
}

interface RecipientStatus {
  walletBalance: string | null;
  pendingApprovals: number;
  adherenceOk: boolean | null;
  loading: boolean;
}

/** Sort key: pending approvals desc, then name asc. */
function sortRecipients(
  items: RecipientListItem[],
  statuses: Record<string, RecipientStatus>,
): RecipientListItem[] {
  return [...items].sort((a, b) => {
    const pa = statuses[a.id]?.pendingApprovals ?? 0;
    const pb = statuses[b.id]?.pendingApprovals ?? 0;
    if (pb !== pa) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}

export function HouseholdTab({
  recipients,
  selectedRecipientId,
  onSelectRecipient,
}: HouseholdTabProps) {
  const [statuses, setStatuses] = useState<Record<string, RecipientStatus>>({});

  // Fetch per-recipient data in parallel on mount / when recipients change
  useEffect(() => {
    if (recipients.length === 0) return;

    // Initialise loading state for all
    const initial: Record<string, RecipientStatus> = {};
    for (const r of recipients) {
      initial[r.id] = {
        walletBalance: null,
        pendingApprovals: 0,
        adherenceOk: null,
        loading: true,
      };
    }
    setStatuses(initial);

    for (const r of recipients) {
      fetchRecipientStatus(r.id).then((s) => {
        setStatuses((prev) => ({ ...prev, [r.id]: { ...s, loading: false } }));
      });
    }
  }, [recipients]);

  const sorted = sortRecipients(recipients, statuses);

  if (recipients.length === 0) {
    return (
      <div
        role="tabpanel"
        id="tabpanel-household"
        aria-labelledby="tab-household"
        tabIndex={0}
        className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400"
      >
        No recipients found. Add a care recipient to get started.
      </div>
    );
  }

  // Single-recipient: don't change the UX, just show an info card instead of a list
  if (recipients.length === 1) {
    const r = recipients[0];
    const s = statuses[r.id];
    return (
      <div
        role="tabpanel"
        id="tabpanel-household"
        aria-labelledby="tab-household"
        tabIndex={0}
        className="space-y-4"
      >
        <p className="text-xs text-slate-500">
          You are managing one care recipient. Add more recipients to see a
          household summary.
        </p>
        <RecipientCard
          recipient={r}
          status={s}
          isSelected={r.id === selectedRecipientId}
          onSelect={onSelectRecipient}
        />
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id="tabpanel-household"
      aria-labelledby="tab-household"
      tabIndex={0}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Household Overview — {recipients.length} recipients
        </h2>
        <p className="text-xs text-slate-400">Sorted by urgency</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sorted.map((r) => (
          <div key={r.id}>
            <RecipientCard
              recipient={r}
              status={statuses[r.id]}
              isSelected={r.id === selectedRecipientId}
              onSelect={onSelectRecipient}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── RecipientCard ─────────────────────────────────────────────────────────────

interface RecipientCardProps {
  recipient: RecipientListItem;
  status: RecipientStatus | undefined;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

function RecipientCard({
  recipient,
  status,
  isSelected,
  onSelect,
}: RecipientCardProps) {
  const pending = status?.pendingApprovals ?? 0;
  const balance = status?.walletBalance ?? null;
  const adherenceOk = status?.adherenceOk ?? null;
  const loading = status?.loading ?? true;

  const urgency =
    pending > 0 ? "high" : adherenceOk === false ? "medium" : "low";

  return (
    <button
      onClick={() => onSelect(recipient.id)}
      aria-pressed={isSelected}
      className={`text-left w-full rounded-xl border p-4 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 cursor-pointer ${
        isSelected
          ? "border-sky-400 bg-sky-50 shadow-sm"
          : urgency === "high"
            ? "border-red-300 bg-red-50 hover:bg-red-100"
            : urgency === "medium"
              ? "border-amber-300 bg-amber-50 hover:bg-amber-100"
              : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-sm font-semibold shrink-0">
            {recipient.name
              .split(" ")
              .map((c) => c[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {recipient.name}
            </div>
            {recipient.age !== null && (
              <div className="text-xs text-slate-400">Age {recipient.age}</div>
            )}
          </div>
        </div>
        {isSelected && (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium bg-sky-500 text-white">
            Active
          </span>
        )}
      </div>

      {/* Status grid */}
      {loading ? (
        <div className="text-xs text-slate-400 animate-pulse">
          Loading status…
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {/* Wallet balance */}
          <div className="bg-white/70 rounded-lg p-2 text-center border border-slate-100">
            <div className="text-xs font-semibold text-slate-700">
              {balance !== null ? `$${balance}` : "—"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">USDC</div>
          </div>

          {/* Pending approvals */}
          <div
            className={`rounded-lg p-2 text-center border ${
              pending > 0
                ? "bg-red-50 border-red-200"
                : "bg-white/70 border-slate-100"
            }`}
          >
            <div
              className={`text-xs font-semibold ${pending > 0 ? "text-red-600" : "text-slate-700"}`}
            >
              {pending}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Approvals</div>
          </div>

          {/* Adherence */}
          <div
            className={`rounded-lg p-2 text-center border ${
              adherenceOk === false
                ? "bg-amber-50 border-amber-200"
                : adherenceOk === true
                  ? "bg-green-50 border-green-200"
                  : "bg-white/70 border-slate-100"
            }`}
          >
            <div
              className={`text-xs font-semibold ${
                adherenceOk === false
                  ? "text-amber-600"
                  : adherenceOk === true
                    ? "text-green-600"
                    : "text-slate-400"
              }`}
            >
              {adherenceOk === null ? "—" : adherenceOk ? "OK" : "Check"}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">Adherence</div>
          </div>
        </div>
      )}

      <p className="mt-3 text-[10px] text-slate-400 text-right">
        Click to switch →
      </p>
    </button>
  );
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchRecipientStatus(
  recipientId: string,
): Promise<RecipientStatus> {
  const base: RecipientStatus = {
    walletBalance: null,
    pendingApprovals: 0,
    adherenceOk: null,
    loading: false,
  };

  try {
    // Spending gives us the wallet balance via the agent /spending endpoint
    const spendingRes = await agentFetch(
      `/agent/spending?recipient_id=${encodeURIComponent(recipientId)}`,
    );
    if (spendingRes.ok) {
      const data = await spendingRes.json();
      // walletBalance comes from the wallet endpoint; spending only has USDC context
      // We'll use budgetRemaining total as a proxy until per-recipient wallet is available
      if (typeof data?.spending?.total === "number") {
        // Can't get per-recipient wallet balance without a dedicated endpoint,
        // so leave walletBalance null here — it shows "—" gracefully in the card
      }
    }
  } catch {
    // non-fatal
  }

  try {
    const pendingRes = await agentFetch(
      `/agent/approvals/pending?recipient_id=${encodeURIComponent(recipientId)}`,
    );
    if (pendingRes.ok) {
      const data = await pendingRes.json();
      base.pendingApprovals = Array.isArray(data)
        ? data.length
        : (data?.count ?? 0);
    }
  } catch {
    // non-fatal
  }

  try {
    const adherenceRes = await agentFetch(
      `/agent/adherence/pending?recipient_id=${encodeURIComponent(recipientId)}`,
    );
    if (adherenceRes.ok) {
      const data = await adherenceRes.json();
      const hasPending = Array.isArray(data?.pending)
        ? data.pending.length > 0
        : false;
      const hasFlagged = Array.isArray(data?.flagged)
        ? data.flagged.length > 0
        : false;
      base.adherenceOk = !hasPending && !hasFlagged;
    }
  } catch {
    // non-fatal
  }

  return base;
}
