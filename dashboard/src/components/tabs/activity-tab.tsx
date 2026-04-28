"use client";

import { useState } from "react";
import { downloadTransactionPDF } from "../../app/pdf";
import type { RecipientProfile } from "../../lib/types";
import { ConfirmDialog } from "../primitives/confirm-dialog";
import { TxLink } from "../primitives/tx-link";
import type {
  AgentLogEntry,
  PaginationData,
  SpendingData,
  Transaction,
} from "../types";

export interface ActivityTabProps {
  recipient: RecipientProfile;
  agentLog: AgentLogEntry[];
  setAgentLog: (entries: AgentLogEntry[]) => void;
  allTransactions: Transaction[];
  pagination: PaginationData | null;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  spending: SpendingData | null;
  onResetAgent: () => void;
}

export function ActivityTab({
  recipient,
  agentLog,
  setAgentLog,
  allTransactions,
  pagination,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  spending,
  onResetAgent,
}: ActivityTabProps) {
  const [showAllLogEntries, setShowAllLogEntries] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div
      role="tabpanel"
      id="tabpanel-activity"
      aria-labelledby="tab-activity"
      tabIndex={0}
      className="space-y-4"
    >
      <ConfirmDialog
        open={confirmOpen}
        title="Reset all agent data?"
        description={`This will delete ${allTransactions.length} transaction${
          allTransactions.length === 1 ? "" : "s"
        }, the agent log, and all audit results. This cannot be undone.`}
        confirmLabel="Delete everything"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onResetAgent();
        }}
      />
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Transaction Log</h2>
        <div className="flex items-center gap-3">
          {allTransactions.length > 0 && (
            <button
              onClick={() =>
                downloadTransactionPDF(allTransactions, spending, { recipient })
              }
              className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
            >
              Download Report
            </button>
          )}
          <button
            onClick={() => setAgentLog([])}
            className="text-xs text-amber-500 hover:text-amber-700 hover:underline active:text-amber-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 rounded px-1"
          >
            Clear Log
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            className="text-xs text-red-500 hover:text-red-700 hover:underline active:text-red-800 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500 rounded px-1"
          >
            Reset All
          </button>
        </div>
      </div>
      <div
        className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-green-400 max-h-48 overflow-y-auto"
        aria-live="polite"
      >
        <div aria-hidden="true">
          {agentLog.length === 0 ? (
            <span className="text-slate-500">No agent activity yet...</span>
          ) : (
            <>
              {!showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mb-2">
                  Showing last 50 of {agentLog.length} entries.{" "}
                  <button
                    onClick={() => setShowAllLogEntries(true)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show all
                  </button>
                </div>
              )}
              {(showAllLogEntries ? agentLog : agentLog.slice(-50)).map(
                (entry) => (
                  <div key={entry.id}>{entry.message}</div>
                ),
              )}
              {showAllLogEntries && agentLog.length > 50 && (
                <div className="text-slate-400 mt-2">
                  <button
                    onClick={() => setShowAllLogEntries(false)}
                    className="text-sky-400 hover:text-sky-300 underline"
                  >
                    Show last 50
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="sr-only">
          {agentLog
            .slice(-20)
            .map((entry) => entry.message)
            .join("\n")}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {allTransactions.length === 0 && !pagination ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No transactions yet
          </div>
        ) : (
          <>
            {pagination && (
              <div className="border-b border-slate-200 px-4 py-3 bg-slate-50">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500">
                    Showing{" "}
                    {Math.min(
                      pagination.limit,
                      pagination.total - pagination.offset,
                    )}{" "}
                    of {pagination.total} transactions
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(0);
                      }}
                      className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                    >
                      <option value={10}>10/page</option>
                      <option value={25}>25/page</option>
                      <option value={50}>50/page</option>
                      <option value={100}>100/page</option>
                    </select>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          setCurrentPage(Math.max(0, currentPage - 1))
                        }
                        disabled={!pagination.hasPrevious}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Previous
                      </button>
                      <span className="px-2 py-1 text-xs text-slate-600">
                        Page {currentPage + 1} of{" "}
                        {Math.ceil(pagination.total / pagination.limit)}
                      </span>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={!pagination.hasMore}
                        className="px-2 py-1 text-xs border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-x-auto shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="hidden md:table-cell text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Time
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Type
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">
                      Description
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Amount
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Status
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-slate-500">
                      Stellar Tx
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allTransactions.map((tx) => (
                    <tr
                      key={tx.id}
                      className="border-b border-slate-100 last:border-0"
                    >
                      <td className="hidden md:table-cell px-4 py-2 text-xs text-slate-400">
                        {new Date(tx.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            tx.type === "medication"
                              ? "bg-blue-100 text-blue-700"
                              : tx.type === "bill"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">{tx.description}</td>
                      <td className="px-4 py-2 text-right text-xs font-mono">
                        $
                        {tx.amount < 0.01
                          ? tx.amount.toFixed(4)
                          : tx.amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            tx.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : tx.status === "blocked"
                                ? "bg-red-100 text-red-700"
                                : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <TxLink hash={tx.stellarTxHash} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
