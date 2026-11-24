"use client";

import { useEffect, useState, useCallback } from "react";
import { caregiverFetch } from "../lib/caregiver-fetch";
import type {
  CostSplit,
  ContributorBalanceSummary,
  CostSplitShare,
} from "../lib/types";
import { Toast } from "./primitives/toast";

export interface CostSplitSectionProps {
  recipientId: string;
  currentCaregiverName?: string;
  currentCaregiverId?: string;
}

export function CostSplitSection({
  recipientId,
  currentCaregiverName = "Primary Caregiver",
  currentCaregiverId = "owner",
}: CostSplitSectionProps) {
  const [splits, setSplits] = useState<CostSplit[]>([]);
  const [summary, setSummary] = useState<ContributorBalanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Manual split form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [payerName, setPayerName] = useState(currentCaregiverName);
  const [contrib1Name, setContrib1Name] = useState("Caregiver 1");
  const [contrib1Amount, setContrib1Amount] = useState("");
  const [contrib2Name, setContrib2Name] = useState("Caregiver 2");
  const [contrib2Amount, setContrib2Amount] = useState("");
  const [submittingSplit, setSubmittingSplit] = useState(false);

  const fetchData = useCallback(async () => {
    if (!recipientId) return;
    try {
      setLoading(true);
      setErrorMsg(null);
      const [splitsRes, balancesRes] = await Promise.all([
        caregiverFetch(`/recipients/${encodeURIComponent(recipientId)}/cost-splits`),
        caregiverFetch(`/recipients/${encodeURIComponent(recipientId)}/cost-splits/balances`),
      ]);

      if (splitsRes.ok) {
        const splitsData = await splitsRes.json();
        setSplits(Array.isArray(splitsData.splits) ? splitsData.splits : []);
      }
      if (balancesRes.ok) {
        const balancesData = await balancesRes.json();
        setSummary(balancesData.summary || null);
      }
    } catch {
      setErrorMsg("Failed to load cost split ledger and balances.");
    } finally {
      setLoading(false);
    }
  }, [recipientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSettle = async (splitId: string, contributorId: string, contributorName: string) => {
    const key = `${splitId}-${contributorId}`;
    try {
      setSettlingKey(key);
      setErrorMsg(null);
      const res = await caregiverFetch(
        `/recipients/${encodeURIComponent(recipientId)}/cost-splits/${encodeURIComponent(splitId)}/settle`,
        {
          method: "POST",
          body: JSON.stringify({ contributorId }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to mark share as settled");
      }

      setToastMsg(`Marked ${contributorName}'s share as paid back.`);
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to settle share.");
    } finally {
      setSettlingKey(null);
    }
  };

  const handleCreateSplit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = parseFloat(totalAmount);
    const amt1 = parseFloat(contrib1Amount);
    const amt2 = parseFloat(contrib2Amount);

    if (isNaN(total) || total <= 0) {
      setErrorMsg("Please provide a valid total amount.");
      return;
    }
    if (isNaN(amt1) || isNaN(amt2) || amt1 <= 0 || amt2 <= 0) {
      setErrorMsg("Please provide valid share amounts for contributors.");
      return;
    }
    if (Math.abs(amt1 + amt2 - total) > 0.05) {
      setErrorMsg(`Shares sum ($${(amt1 + amt2).toFixed(2)}) must equal total ($${total.toFixed(2)}).`);
      return;
    }

    try {
      setSubmittingSplit(true);
      setErrorMsg(null);
      const shares: CostSplitShare[] = [
        {
          caregiverId: currentCaregiverId,
          caregiverName: contrib1Name.trim(),
          amount: amt1,
          status: "settled", // Payer/creator already paid their part
        },
        {
          caregiverId: `contrib-${Date.now()}`,
          caregiverName: contrib2Name.trim(),
          amount: amt2,
          status: "owed",
        },
      ];

      const res = await caregiverFetch(`/recipients/${encodeURIComponent(recipientId)}/cost-splits`, {
        method: "POST",
        body: JSON.stringify({
          transactionId: `manual-split-${Date.now()}`,
          totalAmount: total,
          payerId: currentCaregiverId,
          payerName: payerName.trim() || currentCaregiverName,
          description: description.trim() || "Shared Medical Expense",
          shares,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create cost split");
      }

      setToastMsg("Cost split recorded successfully.");
      setShowAddForm(false);
      setDescription("");
      setTotalAmount("");
      setContrib1Amount("");
      setContrib2Amount("");
      await fetchData();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create cost split.");
    } finally {
      setSubmittingSplit(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
      <Toast message={toastMsg} onDismiss={() => setToastMsg(null)} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Caregiver Cost Splits & Running Balances (#1220)
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Track shared medication and bill expenses, calculate running net balances, and mark reimbursements when paid back.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg text-xs font-medium border border-sky-200 transition-colors shrink-0"
        >
          {showAddForm ? "Cancel Split" : "+ Record Split"}
        </button>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Manual Split Form */}
      {showAddForm && (
        <form onSubmit={handleCreateSplit} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Record Shared Expense Split
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input
                type="text"
                placeholder="e.g. Prescription Co-pay (CVS)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Total Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="50.00"
                value={totalAmount}
                onChange={(e) => {
                  setTotalAmount(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) {
                    const half = (val / 2).toFixed(2);
                    setContrib1Amount(half);
                    setContrib2Amount((val - parseFloat(half)).toFixed(2));
                  }
                }}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Paid by (Primary / Payer)</label>
              <input
                type="text"
                value={payerName}
                onChange={(e) => {
                  setPayerName(e.target.value);
                  setContrib1Name(e.target.value);
                }}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payer's Share ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={contrib1Amount}
                onChange={(e) => setContrib1Amount(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contributor 2 Name</label>
              <input
                type="text"
                value={contrib2Name}
                onChange={(e) => setContrib2Name(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contributor 2's Share ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={contrib2Amount}
                onChange={(e) => setContrib2Amount(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                required
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-3 py-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingSplit}
              className="px-4 py-1.5 bg-sky-600 text-white hover:bg-sky-700 rounded-lg text-xs font-medium disabled:opacity-50"
            >
              {submittingSplit ? "Saving..." : "Save Split"}
            </button>
          </div>
        </form>
      )}

      {/* Running Balances Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
          <div className="text-xs font-medium text-sky-800">Total Outstanding Owed</div>
          <div className="text-xl font-bold text-sky-900 mt-1">
            ${summary?.totalOwed.toFixed(2) ?? "0.00"}
          </div>
          <div className="text-[11px] text-sky-700 mt-1">Reimbursements pending</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-800">Total Settled</div>
          <div className="text-xl font-bold text-emerald-900 mt-1">
            ${summary?.totalSettled.toFixed(2) ?? "0.00"}
          </div>
          <div className="text-[11px] text-emerald-700 mt-1">Paid back to contributors</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-700">Active Splitting Pairs</div>
          <div className="text-xl font-bold text-slate-800 mt-1">
            {summary?.balances.length ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Direct net debt pairs</div>
        </div>
      </div>

      {/* Net Pairwise Balances Details */}
      {summary && summary.balances.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
            Net Balances Between Contributors
          </h3>
          <div className="space-y-2">
            {summary.balances.map((b, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-lg p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800">{b.fromCaregiverName}</span>
                  <span className="text-slate-500">owes</span>
                  <span className="font-semibold text-slate-800">{b.toCaregiverName}</span>
                </div>
                <div className="font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  ${b.amount.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Splits Ledger Table */}
      <div>
        <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
          Expense Splits Ledger
        </h3>
        {loading ? (
          <div className="py-8 text-center text-xs text-slate-500 animate-pulse">
            Loading expense splits ledger...
          </div>
        ) : splits.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-500">
            No caregiver cost splits recorded yet. Medication or bill payments with configured cost splits will appear here.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Description</th>
                  <th className="py-2.5 px-3 font-semibold">Payer</th>
                  <th className="py-2.5 px-3 font-semibold">Total</th>
                  <th className="py-2.5 px-3 font-semibold">Shares & Settlement Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {splits.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="py-3 px-3 whitespace-nowrap text-slate-500">
                      {new Date(s.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800">
                      {s.description || "Medical Expense"}
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Tx: {s.transactionId.slice(0, 16)}...
                      </div>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-700">
                      {s.payerName}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-900 whitespace-nowrap">
                      ${s.totalAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-3">
                      <div className="space-y-1.5">
                        {s.shares.map((share, sIdx) => {
                          const isSettling = settlingKey === `${s.id}-${share.caregiverId}`;
                          return (
                            <div
                              key={sIdx}
                              className="flex items-center justify-between gap-3 text-[11px] bg-slate-50 px-2 py-1 rounded border border-slate-200/60"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-slate-800">{share.caregiverName}</span>
                                <span className="text-slate-400">·</span>
                                <span className="font-mono text-slate-700">${share.amount.toFixed(2)}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {share.status === "settled" ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-medium text-[10px]">
                                    ✓ Paid Back
                                    {share.settledAt && (
                                      <span className="text-[9px] text-emerald-600">
                                        ({new Date(share.settledAt).toLocaleDateString()})
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <>
                                    <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-medium text-[10px]">
                                      Owed
                                    </span>
                                    <button
                                      type="button"
                                      disabled={isSettling}
                                      onClick={() => handleSettle(s.id, share.caregiverId, share.caregiverName)}
                                      className="px-2 py-0.5 bg-sky-600 text-white hover:bg-sky-700 rounded text-[10px] font-medium transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      {isSettling ? "Saving..." : "Mark Paid Back"}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
