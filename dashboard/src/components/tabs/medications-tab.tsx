"use client";

import { toast } from "sonner";
import { downloadMedicationPDF } from "../../app/pdf";
import {
  DrugInteractionResultSchema,
  PharmacyCompareResultSchema,
  type RecipientProfile,
} from "../../lib/types";
import type { AgentResult } from "../types";
import { getTranslations, type Locale } from "../../i18n";

const MEDS = ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"] as const;

export interface MedicationsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
  locale?: Locale;
}

export function MedicationsTab({ agentResult, recipient, locale = "en" }: MedicationsTabProps) {
  const t = getTranslations(locale).medications;
  const hasPriceResults = agentResult?.toolCalls.some(
    (t) => t.tool === "compare_pharmacy_prices",
  );
  const interactionCalls = agentResult?.toolCalls.filter(
    (t) => t.tool === "check_drug_interactions",
  );

  return (
    <div
      role="tabpanel"
      id="tabpanel-medications"
      aria-labelledby="tab-medications"
      tabIndex={0}
      className="space-y-6"
    >
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">
            {t.title}
          </h2>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={() => {
                if (!hasPriceResults) return;
                try {
                  const priceResults = agentResult!.toolCalls
                    .filter((t) => t.tool === "compare_pharmacy_prices")
                    .map((t) => PharmacyCompareResultSchema.parse(t.result));
                  const interactionResult = agentResult!.toolCalls.find(
                    (t) => t.tool === "check_drug_interactions",
                  )?.result;
                  downloadMedicationPDF(
                    {
                      priceResults,
                      interactionResult: interactionResult
                        ? DrugInteractionResultSchema.parse(interactionResult)
                        : undefined,
                    },
                    { recipient },
                  );
                } catch {
                  toast.error("Couldn't parse medication result — try again");
                }
              }}
              disabled={!hasPriceResults}
              title={hasPriceResults ? undefined : t.downloadPdfHint}
              aria-describedby={
                !hasPriceResults ? "medications-download-hint" : undefined
              }
              className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-sky-50"
            >
              {t.downloadPdf}
            </button>
            {!hasPriceResults && (
              <span
                id="medications-download-hint"
                className="text-[10px] text-slate-400"
              >
                {t.downloadPdfHint}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {MEDS.map((drug) => {
            const r = agentResult?.toolCalls.find(
              (t) =>
                t.tool === "compare_pharmacy_prices" &&
                t.result?.drug?.toLowerCase() === drug.toLowerCase(),
            )?.result;
            return (
              <div
                key={drug}
                className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-sm">{drug}</div>
                  <div className="text-xs text-slate-500">
                    {r
                      ? `${t.best}: ${r.cheapest.pharmacyName} at $${r.cheapest.price}`
                      : t.notYetCompared}
                  </div>
                </div>
                {r && (
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600">
                      {t.save} ${r.potentialSavings}/mo
                    </div>
                    <div className="text-xs text-slate-400">
                      {r.savingsPercent}% {t.savings}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {interactionCalls && interactionCalls.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            {t.drugInteractions}
          </h2>
          {/* Stable key: tool-call id (or input composite) survives list reordering. */}
          <div className="space-y-4">
            {interactionCalls.map((t) => {
              const interactions = t.result.interactions ?? [];
              return (
                <div
                  key={t.id ?? `interaction-${JSON.stringify(t.input)}`}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  {t.result.summary && (
                    <p className="text-sm text-slate-600">{t.result.summary}</p>
                  )}
                  {interactions.length > 0 && (
                    <div
                      className={`space-y-2 ${t.result.summary ? "mt-4 border-t border-slate-200 pt-4" : ""}`}
                    >
                      {interactions.map((ix: any) => (
                        <div
                          key={`${ix.drug1}-${ix.drug2}`}
                          className={`p-3 rounded-lg text-sm ${ix.severity === "severe"
                            ? "bg-red-50 border border-red-200"
                            : ix.severity === "moderate"
                              ? "bg-amber-50 border border-amber-200"
                              : "bg-blue-50 border border-blue-200"
                            }`}
                        >
                          <div className="font-medium">
                            {ix.drug1} + {ix.drug2} ({ix.severity})
                          </div>
                          <div className="text-xs mt-1 text-slate-600">
                            {ix.recommendation}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}