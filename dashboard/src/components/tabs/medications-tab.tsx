"use client";

import { downloadMedicationPDF } from "../../app/pdf";
import {
  DrugInteractionResultSchema,
  PharmacyCompareResultSchema,
  type RecipientProfile,
} from "../../lib/types";
import type { AgentResult } from "../types";

const MEDS = ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"] as const;

export interface MedicationsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
}

export function MedicationsTab({ agentResult, recipient }: MedicationsTabProps) {
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
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {recipient.name}&apos;s Medications
          </h2>
          {hasPriceResults && (
            <button
              onClick={() => {
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
              }}
              className="min-h-11 rounded-lg bg-sky-50 px-4 py-3 text-xs font-medium text-sky-700 transition-all cursor-pointer hover:bg-sky-100 active:bg-sky-200"
            >
              Download PDF
            </button>
          )}
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
                className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">{drug}</div>
                  <div className="text-xs text-slate-500">
                    {r
                      ? `Best: ${r.cheapest.pharmacyName} at $${r.cheapest.price}`
                      : "Not yet compared"}
                  </div>
                </div>
                {r && (
                  <div className="text-left sm:text-right">
                    <div className="text-sm font-medium text-green-600">
                      Save ${r.potentialSavings}/mo
                    </div>
                    <div className="text-xs text-slate-400">
                      {r.savingsPercent}% savings
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
          {interactionCalls && interactionCalls.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Drug Interactions
          </h2>
          {interactionCalls.map((t, i) => (
            <div key={i} className="space-y-2">
              {(() => {
                const interaction = DrugInteractionResultSchema.parse(t.result);

                return (
                  <>
                    <p className="text-sm text-slate-600">
                      {interaction.summary}
                    </p>
                    {interaction.interactions?.map((ix, j: number) => (
                <div
                  key={j}
                  className={`p-3 rounded-lg text-sm ${
                    ix.severity === "severe"
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
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
