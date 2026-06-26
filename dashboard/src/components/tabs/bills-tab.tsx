"use client";

import { useState, useCallback } from "react";
import { downloadBillAuditPDF, downloadDisputeLetterPDF, downloadDisputeLetterEmail } from "../../app/pdf";
import {
  BillAuditResultSchema,
  type RecipientProfile,
  type DisputeLetter,
} from "../../lib/types";
import { BillLineItemsVirtualized } from "../primitives/bill-line-items-virtualized";
import type { AgentResult } from "../types";

export interface BillsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
}

export function BillsTab({ agentResult, recipient }: BillsTabProps) {
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [generatingDispute, setGeneratingDispute] = useState<string | null>(null);

  const auditCalls = agentResult?.toolCalls.filter(
    (t) =>
      t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
  );

  const handleDispute = useCallback(async (auditResult: any, index: number) => {
    setGeneratingDispute(`dispute-${index}`);
    try {
      const letter: DisputeLetter = {
        billId: `bill-${Date.now()}`,
        recipientName: recipient.name,
        facility: recipient.facility || "General Hospital",
        totalOvercharge: auditResult.totalOvercharge,
        errorCount: auditResult.errorCount,
        emailText: generateDisputeText(auditResult, recipient),
        emailHtml: generateDisputeHtml(auditResult, recipient),
        generatedAt: new Date().toISOString(),
      };
      downloadDisputeLetterPDF(letter);
    } finally {
      setGeneratingDispute(null);
    }
  }, [recipient]);

  const handleDisputeEmail = useCallback(async (auditResult: any) => {
    const letter: DisputeLetter = {
      billId: `bill-${Date.now()}`,
      recipientName: recipient.name,
      facility: recipient.facility || "General Hospital",
      totalOvercharge: auditResult.totalOvercharge,
      errorCount: auditResult.errorCount,
      emailText: generateDisputeText(auditResult, recipient),
      emailHtml: generateDisputeHtml(auditResult, recipient),
      generatedAt: new Date().toISOString(),
    };
    const html = downloadDisputeLetterEmail(letter);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  }, [recipient]);

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
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">
                Bill Audit Results
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    downloadBillAuditPDF(BillAuditResultSchema.parse(t.result), {
                      errorsOnly: showErrorsOnly,
                      recipient,
                    })
                  }
                  className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
                >
                  Download PDF
                </button>
                {t.result.errorCount > 0 && (
                  <>
                    <button
                      onClick={() => handleDispute(t.result, i)}
                      disabled={generatingDispute === `dispute-${i}`}
                      className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 active:bg-red-200 cursor-pointer transition-all disabled:opacity-50"
                    >
                      {generatingDispute === `dispute-${i}` ? "Generating..." : "Dispute"}
                    </button>
                    <button
                      onClick={() => handleDisputeEmail(t.result)}
                      className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 active:bg-amber-200 cursor-pointer transition-all"
                    >
                      Email Text
                    </button>
                  </>
                )}
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    t.result.errorCount > 0
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {t.result.errorCount} errors found
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold">${t.result.totalCharged}</div>
                <div className="text-xs text-slate-500">Total Charged</div>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-red-600">
                  ${t.result.totalOvercharge}
                </div>
                <div className="text-xs text-slate-500">Overcharges</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-green-600">
                  ${t.result.totalCorrect}
                </div>
                <div className="text-xs text-slate-500">Correct Amount</div>
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-500">
                {t.result.lineItems.length} line items
              </span>
              <button
                onClick={() => setShowErrorsOnly(!showErrorsOnly)}
                className="text-xs text-sky-600 hover:text-sky-800 cursor-pointer"
              >
                {showErrorsOnly ? "Show all items" : "Show errors only"}
              </button>
            </div>
            <BillLineItemsVirtualized
              lineItems={t.result.lineItems.filter(
                (item: any) => !showErrorsOnly || item.status !== "valid",
              )}
            />
            <p className="mt-4 text-sm font-medium text-slate-700">
              {t.result.recommendation}
            </p>
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

function generateDisputeText(auditResult: any, recipient: RecipientProfile): string {
  const errorItems = (auditResult.lineItems || []).filter((item: any) => item.status !== "valid");
  const lines: string[] = [];
  lines.push(`Dear ${recipient.facility || "General Hospital"} Billing Department,`);
  lines.push("");
  lines.push(`I am writing on behalf of ${recipient.name} to formally dispute the following billing errors:`);
  lines.push("");
  for (const item of errorItems) {
    lines.push(`  - ${item.description}${item.cptCode ? ` (CPT: ${item.cptCode})` : ""}: Charged $${item.chargedAmount.toFixed(2)}`);
    if (item.suggestedAmount !== undefined) {
      lines.push(`    Fair market rate: $${item.suggestedAmount.toFixed(2)}`);
    }
    if (item.errorDescription) {
      lines.push(`    Issue: ${item.errorDescription}`);
    }
    lines.push("");
  }
  lines.push(`Total overcharge: $${auditResult.totalOvercharge.toFixed(2)}`);
  lines.push("");
  lines.push("We request these charges be reviewed and corrected.");
  lines.push("");
  lines.push("Sincerely,");
  lines.push("Maria Garcia");
  return lines.join("\n");
}

function generateDisputeHtml(auditResult: any, recipient: RecipientProfile): string {
  const errorItems = (auditResult.lineItems || []).filter((item: any) => item.status !== "valid");
  const itemsHtml = errorItems.map((item: any) =>
    `<li><strong>${item.description}</strong>${item.cptCode ? ` (CPT: ${item.cptCode})` : ""}: Charged $${item.chargedAmount.toFixed(2)}${item.suggestedAmount !== undefined ? ` — Fair rate: $${item.suggestedAmount.toFixed(2)}` : ""}${item.errorDescription ? `<br/><em>${item.errorDescription}</em>` : ""}</li>`
  ).join("");
  return `
<h2>Medical Bill Dispute</h2>
<p>Dear ${recipient.facility || "General Hospital"} Billing Department,</p>
<p>I am writing on behalf of <strong>${recipient.name}</strong> to formally dispute billing errors.</p>
<h3>Discrepancies:</h3>
<ul>${itemsHtml}</ul>
<p><strong>Total overcharge: $${auditResult.totalOvercharge.toFixed(2)}</strong></p>
<p>We request these charges be reviewed and corrected.</p>
<p>Sincerely,<br/>Maria Garcia</p>
`.trim();
}
