"use client";

import { useState, useCallback } from "react";
import {
  downloadBillAuditPDF,
  downloadDisputeLetterPDF,
  downloadDisputeLetterEmail,
} from "../../app/pdf";
import {
  BillAuditResultSchema,
  type RecipientProfile,
  type DisputeLetter,
  type ItemPresenceMap,
  type CaregiverProfile,
  type ConsentSettings,
} from "../../lib/types";
import { BillLineItemsVirtualized } from "../primitives/bill-line-items-virtualized";
import { sanitizeAnnotation } from "../../lib/sanitize";
import type { AgentResult } from "../types";
import { getTranslations, type Locale } from "../../i18n";
import { AGENT_URL } from "../../lib/agent-url";
import { agentFetch } from "../../lib/agent-fetch";

export interface EditableLineItem {
  id: string;
  description: string;
  cptCode?: string;
  quantity: number;
  chargedAmount: number;
}

export interface BillsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
  locale?: Locale;
  currentCaregiver?: CaregiverProfile;
  linkedCaregivers?: CaregiverProfile[];
  consentSettings?: ConsentSettings;
}

/**
 * Per-bill annotation state.
 * Key: the line-item description (unique within a bill).
 * Value: sanitized free-text note entered by the caregiver.
 */
type BillAnnotations = Record<string, string>;

export function BillsTab({ agentResult, recipient }: BillsTabProps) {
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [generatingDispute, setGeneratingDispute] = useState<string | null>(
    null,
  );
  /**
   * Annotations keyed by bill-index so each audit card has its own map.
   * Structure: { [billIndex]: { [lineItemDescription]: annotationText } }
   */
  const [allAnnotations, setAllAnnotations] = useState<
    Record<number, BillAnnotations>
  >({});

  const auditCalls = agentResult?.toolCalls.filter(
    (t) => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
  );

  const handleAnnotate = useCallback(
    (billIndex: number, description: string, raw: string) => {
      const sanitized = sanitizeAnnotation(raw);
      setAllAnnotations((prev) => ({
        ...prev,
        [billIndex]: {
          ...(prev[billIndex] ?? {}),
          [description]: sanitized,
        },
      }));
    },
    [],
  );

  const handleDispute = useCallback(
    async (auditResult: any, index: number) => {
      setGeneratingDispute(`dispute-${index}`);
      try {
        const annotations = allAnnotations[index] ?? {};
        const letter: DisputeLetter = {
          billId: `bill-${Date.now()}`,
          recipientName: recipient.name,
          facility: recipient.facility || "General Hospital",
          totalOvercharge: auditResult.totalOvercharge,
          errorCount: auditResult.errorCount,
          emailText: generateDisputeText(auditResult, recipient, annotations),
          emailHtml: generateDisputeHtml(auditResult, recipient, annotations),
          generatedAt: new Date().toISOString(),
        };
        downloadDisputeLetterPDF(letter);
      } finally {
        setGeneratingDispute(null);
      }
    },
    [recipient, allAnnotations],
  );

  const handleDisputeEmail = useCallback(
    async (auditResult: any, index: number) => {
      const annotations = allAnnotations[index] ?? {};
      const letter: DisputeLetter = {
        billId: `bill-${Date.now()}`,
        recipientName: recipient.name,
        facility: facilityName || recipient.facility || "General Hospital",
        totalOvercharge: auditResult.totalOvercharge,
        errorCount: auditResult.errorCount,
        emailText: generateDisputeText(auditResult, recipient, annotations),
        emailHtml: generateDisputeHtml(auditResult, recipient, annotations),
        generatedAt: new Date().toISOString(),
      };
      const html = downloadDisputeLetterEmail(letter);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    },
    [recipient, allAnnotations],
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
        auditCalls.map((t, i) => {
          const annotations = allAnnotations[i] ?? {};
          const annotatedCount =
            Object.values(annotations).filter(Boolean).length;

          return (
            <div
              key={i}
              className="bg-white rounded-xl border border-slate-200 p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-slate-700">
                  Bill Audit Results
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() =>
                      downloadBillAuditPDF(
                        BillAuditResultSchema.parse(t.result),
                        {
                          errorsOnly: showErrorsOnly,
                          recipient,
                        },
                      )
                    }
                    className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all"
                  >
                    Download PDF
                  </button>
                  {t.result.errorCount > 0 && (
                    <>
                      <select
                        aria-label="Dispute reason template"
                        value={selectedTemplate}
                        onChange={(e) => {
                          const nextTpl = e.target.value as DisputeReasonTemplate;
                          setSelectedTemplate(nextTpl);
                          setCustomLetterBody((prev) => ({
                            ...prev,
                            [auditCallKey(tc)]: generateDisputeText(tc.result, recipient, nextTpl),
                          }));
                        }}
                        className="text-xs px-2 py-1 border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      >
                        <option value="duplicate_charge">Duplicate Billing (CMS Ch. 1 § 80.3.2)</option>
                        <option value="coding_error">Coding Discrepancy / Upcoding (AMA CPT)</option>
                        <option value="balance_billing">Balance Billing (No Surprises Act 45 CFR § 149)</option>
                        <option value="unbundling">Unbundled Service Charges (CMS NCCI)</option>
                        <option value="general_dispute">General Discrepancy & Fair-Market Audit</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          const key = auditCallKey(tc);
                          if (editingAuditKey === key) {
                            setEditingAuditKey(null);
                          } else {
                            setEditingAuditKey(key);
                            if (!customLetterBody[key]) {
                              setCustomLetterBody((prev) => ({
                                ...prev,
                                [key]: generateDisputeText(tc.result, recipient, selectedTemplate),
                              }));
                            }
                          }
                        }}
                        className="px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium hover:bg-slate-200 cursor-pointer transition-all"
                      >
                        {editingAuditKey === auditCallKey(tc) ? "Hide Preview" : "Preview & Edit"}
                      </button>

                      <button
                        onClick={() => handleDispute(t.result, i)}
                        disabled={generatingDispute === `dispute-${i}`}
                        className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 active:bg-red-200 cursor-pointer transition-all disabled:opacity-50"
                      >
                        {generatingDispute === `dispute-${i}`
                          ? "Generating..."
                          : "Dispute"}
                      </button>
                      <button
                        onClick={() => handleDisputeEmail(t.result, i)}
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
                  {annotatedCount > 0 && (
                    <span className="px-3 py-1 rounded-full text-xs font-medium bg-sky-100 text-sky-700">
                      {annotatedCount} note{annotatedCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold">
                    ${t.result.totalCharged}
                  </div>
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
                annotations={annotations}
                onAnnotate={(description, raw) =>
                  handleAnnotate(i, description, raw)
                }
              />
              <p className="mt-4 text-sm font-medium text-slate-700">
                {t.result.recommendation}
              </p>
            </div>
          );
        })
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-sm text-slate-400">
          No bills audited yet. Run &quot;Audit Hospital Bill&quot; from
          Overview.
        </div>
      )}
    </div>
  );
}

function generateDisputeText(
  auditResult: any,
  recipient: RecipientProfile,
  annotations: BillAnnotations,
): string {
  const errorItems = (auditResult.lineItems || []).filter(
    (item: any) => item.status !== "valid",
  );
  const lines: string[] = [];
  lines.push(
    `Dear ${recipient.facility || "General Hospital"} Billing Department,`,
  );
  lines.push("");
  lines.push(
    `I am writing on behalf of ${recipient.name} to formally dispute the following billing errors:`,
  );
  lines.push("");
  for (const item of errorItems) {
    lines.push(
      `  - ${item.description}${item.cptCode ? ` (CPT: ${item.cptCode})` : ""}: Charged $${item.chargedAmount.toFixed(2)}`,
    );
    if (item.suggestedAmount !== undefined) {
      lines.push(`    Fair market rate: $${item.suggestedAmount.toFixed(2)}`);
    }
    if (item.errorDescription) {
      lines.push(`    Issue: ${item.errorDescription}`);
    }
    const note = annotations[item.description];
    if (note) {
      lines.push(`    Caregiver note: ${note}`);
    }
    lines.push("");
  }
  lines.push(`Total overcharge: $${auditResult.totalOvercharge.toFixed(2)}`);
  lines.push("");
  lines.push("We request these charges be reviewed and corrected.");
  lines.push("");
  lines.push("Sincerely,");
  lines.push(recipient.name ? `Caregiver of ${recipient.name}` : "Caregiver");
  return lines.join("\n");
}

function generateDisputeHtml(
  auditResult: any,
  recipient: RecipientProfile,
  annotations: BillAnnotations,
): string {
  const errorItems = (auditResult.lineItems || []).filter(
    (item: any) => item.status !== "valid",
  );
  const itemsHtml = errorItems
    .map((item: any) => {
      const note = annotations[item.description];
      return (
        `<li><strong>${item.description}</strong>` +
        `${item.cptCode ? ` (CPT: ${item.cptCode})` : ""}` +
        `: Charged $${item.chargedAmount.toFixed(2)}` +
        `${item.suggestedAmount !== undefined ? ` — Fair rate: $${item.suggestedAmount.toFixed(2)}` : ""}` +
        `${item.errorDescription ? `<br/><em>${item.errorDescription}</em>` : ""}` +
        `${note ? `<br/><span style="color:#0369a1">Note: ${note}</span>` : ""}` +
        `</li>`
      );
    })
    .join("");
  return `
<h2>Medical Bill Dispute</h2>
<p>Dear ${recipient.facility || "General Hospital"} Billing Department,</p>
<p>I am writing on behalf of <strong>${recipient.name}</strong> to formally dispute billing errors.</p>
<h3>Discrepancies:</h3>
<ul>${itemsHtml}</ul>
<p><strong>Total overcharge: $${auditResult.totalOvercharge.toFixed(2)}</strong></p>
<p>We request these charges be reviewed and corrected.</p>
<p>Sincerely,<br/>${recipient.name ? `Caregiver of ${recipient.name}` : "Caregiver"}</p>
`.trim();
}
