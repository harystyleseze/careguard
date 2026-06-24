"use client";

import { useState, useEffect } from "react";
import type { Transaction } from "../types";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

export interface ApprovalsTabProps {
  agentConnected: boolean;
}

export function ApprovalsTab({ agentConnected }: ApprovalsTabProps) {
  const [approvals, setApprovals] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchApprovals = async () => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/pending-approvals`);
      if (!res.ok) return;
      const data = await res.json();
      setApprovals(data.approvals || []);
    } catch {}
  };

  useEffect(() => {
    fetchApprovals();
    const i = setInterval(fetchApprovals, 5000);
    return () => clearInterval(i);
  }, []);

  const handleApprove = async (txId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_URL}/agent/approvals/${txId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: true }),
      });
      if (res.ok) fetchApprovals();
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (txId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`${AGENT_URL}/agent/approvals/${txId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve: false }),
      });
      if (res.ok) fetchApprovals();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="tabpanel"
      id="tabpanel-approvals"
      aria-labelledby="tab-approvals"
      tabIndex={0}
      className="space-y-6"
    >
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Pending Approvals
        </h2>
        {!agentConnected && (
          <p className="text-xs text-slate-500">Agent not connected.</p>
        )}
        {agentConnected && approvals.length === 0 && (
          <p className="text-xs text-slate-500">No pending approvals.</p>
        )}
        {approvals.length > 0 && (
          <div className="space-y-3">
            {approvals.map((tx) => (
              <div key={tx.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      {tx.description}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Amount: ${tx.amount.toFixed(2)} | Category: {tx.category}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {new Date(tx.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                      onClick={() => handleApprove(tx.id)}
                      disabled={loading}
                      className="w-full rounded-lg bg-green-600 px-4 py-3 text-xs font-medium text-white cursor-pointer hover:bg-green-700 disabled:opacity-50 sm:w-auto"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReject(tx.id)}
                      disabled={loading}
                      className="w-full rounded-lg bg-red-600 px-4 py-3 text-xs font-medium text-white cursor-pointer hover:bg-red-700 disabled:opacity-50 sm:w-auto"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
            You can review and approve or reject each pending transaction here.
            Approving will execute the payment; rejecting will cancel it.
          </p>
        </div>
      </div>
    </div>
  );
}
