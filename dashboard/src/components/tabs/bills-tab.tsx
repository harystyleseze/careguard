"use client";

import { useState } from "react";
import { downloadBillAuditPDF } from "../../app/pdf";
import {
  BillAuditResultSchema,
  type RecipientProfile,
} from "../../lib/types";
import {
  BillLineItemsVirtualized,
  type BillLineItem,
} from "../primitives/bill-line-items-virtualized";
import type { AgentResult } from "../types";

export interface BillsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
}

export function BillsTab({ agentResult, recipient }: BillsTabProps) {
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  const auditCalls = agentResult?.toolCalls.filter(
    (t) =>
      t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
  );

  return (
    <div
      role="tabpanel"
      id="tabpanel-bills"
      aria-labelledby="tab-bills"
      tabIndex={0}
      className="space-y-6"
    >
      {auditCalls && auditCalls.length > 0 ? (
        auditCalls.map((t, i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6"
          >
            {(() => {
              const result = BillAuditResultSchema.parse(t.result);

              return (
                <>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                Bill Audit Results
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    downloadBillAuditPDF(result, {
                      errorsOnly: showErrorsOnly,
                      recipient,
                    })
                  }
                  className="min-h-11 px-4 py-3 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
                >
                  Download PDF
                </button>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    result.errorCount > 0
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {result.errorCount} errors found
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 mb-4 sm:grid-cols-3">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold">${result.totalCharged}</div>
                <div className="text-xs text-slate-500">Total Charged</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-red-600">
                  ${result.totalOvercharge}
                </div>
                <div className="text-xs text-slate-500">Overcharges</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-green-600">
                  ${result.totalCorrect}
                </div>
                <div className="text-xs text-slate-500">Correct Amount</div>
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">
                {result.lineItems.length} line items
              </span>
              <button
                onClick={() => setShowErrorsOnly(!showErrorsOnly)}
                className="min-h-11 px-2 text-xs text-sky-600 hover:text-sky-800 cursor-pointer"
              >
                {showErrorsOnly ? "Show all items" : "Show errors only"}
              </button>
            </div>
            <BillLineItemsVirtualized
              lineItems={t.result.lineItems.filter(
                (item: BillLineItem) => !showErrorsOnly || item.status !== "valid",
              )}
            />
            <p className="mt-4 text-sm font-medium text-slate-700">
              {result.recommendation}
            </p>
                </>
              );
            })()}
          </div>
        ))
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          No bills audited yet. Run &quot;Audit Hospital Bill&quot; from Overview.
        </div>
      )}
    </div>
  );
}
