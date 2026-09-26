"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { downloadBillAuditPDF, downloadDisputeLetterPDF, downloadDisputeLetterEmail } from "../../app/pdf";
import {
  BillAuditResultSchema,
  type RecipientProfile,
  type DisputeLetter,
} from "../../lib/types";
import { BillLineItemsVirtualized, type BillLineItem } from "../primitives/bill-line-items-virtualized";
import type { AgentResult } from "../types";
import { getTranslations, type Locale } from "../../i18n";

export interface BillsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
  locale?: Locale;
}

export function BillsTab({ agentResult, recipient, locale = "en" }: BillsTabProps) {
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [sortByOvercharge, setSortByOvercharge] = useState(false);
  const [generatingDispute, setGeneratingDispute] = useState<string | null>(null);
  const b = getTranslations(locale).bills;

  const overchargeAmount = (item: BillLineItem) =>
    item.status !== "valid" && item.suggestedAmount !== undefined
      ? item.chargedAmount - item.suggestedAmount
      : 0;

  const auditCalls = agentResult?.toolCalls.filter(
    (t) =>
      t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
  );

  const auditCallKey = (tc: NonNullable<typeof auditCalls>[number]) =>
    tc.id ?? `${tc.tool}-${JSON.stringify(tc.input)}`;

  const handleDispute = useCallback(async (auditResult: any, auditKey: string) => {
    setGeneratingDispute(auditKey);
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
      toast.success("Dispute letter PDF downloaded");
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
        auditCalls.map((tc) => {
          const visibleLineItems = tc.result.lineItems.filter(
            (item: any) => !showErrorsOnly || item.status !== "valid",
          );
          const sortedLineItems = sortByOvercharge
            ? [...visibleLineItems].sort(
                (a: BillLineItem, b: BillLineItem) => overchargeAmount(b) - overchargeAmount(a),
              )
            : visibleLineItems;
          return (
            <div
              // The tool-call ID (or legacy payload composite) stays stable across list reordering.
              key={auditCallKey(tc)}
              className="bg-white rounded-xl border border-slate-200 p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">
                  {b.title}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      try {
                        downloadBillAuditPDF(BillAuditResultSchema.parse(tc.result), {
                          errorsOnly: showErrorsOnly,
                          recipient,
                        });
                      } catch {
                        toast.error("Couldn't parse bill audit result — try again");
                      }
                    }}
                    className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
                  >
                    {b.downloadPdf}
                  </button>
                  {tc.result.errorCount > 0 && (
                    <>
                      <button
                        onClick={() => handleDispute(tc.result, auditCallKey(tc))}
                        disabled={generatingDispute === auditCallKey(tc)}
                        className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 active:bg-red-200 cursor-pointer transition-all disabled:opacity-50"
                      >
                        {generatingDispute === auditCallKey(tc) ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="inline-block w-3 h-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin"
                      />
                      Generating...
                    </>
                  ) : (
                    "Dispute"
                  )}
                      </button>
                      <button
                        onClick={() => handleDisputeEmail(tc.result)}
                        className="px-3 py-1.5 bg-amber-50 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 active:bg-amber-200 cursor-pointer transition-all"
                      >
                        Email Text
                      </button>
                    </>
                  )}
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${tc.result.errorCount > 0
                      ? "bg-red-100 text-red-700"
                      : "bg-green-100 text-green-700"
                      }`}
                  >
                    {tc.result.errorCount} {b.errorsFound}
                  </span>
                </div>
              </div>
              {/* #1255: the recommendation is the actionable takeaway — give
                  it top billing in an advisory callout, detail below. */}
              {tc.result.recommendation?.trim() ? (
                <div
                  role="note"
                  aria-label="Audit recommendation"
                  className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4"
                >
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-1">
                    Recommendation
                  </p>
                  <p className="text-sm font-medium text-amber-900 break-words">
                    {tc.result.recommendation}
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">${tc.result.totalCharged}</div>
                  <div className="text-xs text-slate-500">{b.totalCharged}</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-red-600">
                    ${tc.result.totalOvercharge}
                  </div>
                  <div className="text-xs text-slate-500">{b.overcharges}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-green-600">
                    ${tc.result.totalCorrect}
                  </div>
                  <div className="text-xs text-slate-500">{b.correctAmount}</div>
                </div>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500">
                  {tc.result.lineItems.length} {b.lineItems}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSortByOvercharge(!sortByOvercharge)}
                    aria-pressed={sortByOvercharge}
                    className="text-xs text-sky-600 hover:text-sky-800 cursor-pointer"
                  >
                    {sortByOvercharge ? b.sortDefault : b.sortByOvercharge}
                  </button>
                  <button
                    onClick={() => setShowErrorsOnly(!showErrorsOnly)}
                    aria-pressed={showErrorsOnly}
                    className="text-xs text-sky-600 hover:text-sky-800 cursor-pointer"
                  >
                    {showErrorsOnly ? b.showAll : b.showErrors}
                  </button>
                </div>
              </div>
              <BillLineItemsVirtualized lineItems={sortedLineItems} />
            </div>
          );
        })
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          {b.notAudited}
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
