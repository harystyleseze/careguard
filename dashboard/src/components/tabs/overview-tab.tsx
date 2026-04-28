"use client";

import { Bar } from "../primitives/bar";
import { Btn } from "../primitives/btn";
import { Card } from "../primitives/card";
import type { AgentResult, SpendingData } from "../types";

export interface OverviewTabProps {
  spending: SpendingData | null;
  agentResult: AgentResult | null;
  agentPaused: boolean;
  loading: boolean;
  activeTask: string;
  onRunTask: (task: string, label: string) => void;
}

const TASKS = {
  meds: "Compare prices for all of Rosa's medications (lisinopril, metformin, atorvastatin, amlodipine) and order from the cheapest pharmacies. Also check for drug interactions.",
  bill: "Audit Rosa's hospital bill from General Hospital and pay the corrected amount if errors are found.",
  block: "Pay a $600 medical bill to General Hospital for Rosa's recent surgery follow-up.",
};

export function OverviewTab({
  spending,
  agentResult,
  agentPaused,
  loading,
  activeTask,
  onRunTask,
}: OverviewTabProps) {
  const savings = agentResult
    ? agentResult.toolCalls
        .filter((t) => t.tool === "compare_pharmacy_prices")
        .reduce((s, t) => s + (t.result?.potentialSavings || 0), 0)
    : 0;
  const overcharges = agentResult
    ? agentResult.toolCalls
        .filter(
          (t) => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
        )
        .reduce((s, t) => s + (t.result?.totalOvercharge || 0), 0)
    : 0;

  return (
    <div
      role="tabpanel"
      id="tabpanel-overview"
      aria-labelledby="tab-overview"
      tabIndex={0}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          label="Monthly Spending"
          value={`$${spending?.spending.total.toFixed(2) || "0.00"}`}
          sub={`of $${spending?.policy.monthlyLimit || 500} limit`}
          color="sky"
        />
        <Card
          label="Savings Found"
          value={agentResult ? `$${savings.toFixed(2)}/mo` : "$0.00/mo"}
          sub="by switching pharmacies"
          color="green"
        />
        <Card
          label="Billing Errors Caught"
          value={agentResult ? `$${overcharges.toFixed(2)}` : "$0.00"}
          sub="in overcharges identified"
          color="amber"
        />
        <Card
          label="Agent API Costs"
          value={`$${spending?.spending.serviceFees.toFixed(4) || "0.0000"}`}
          sub={`${spending?.transactionCount || 0} queries via x402`}
          color="slate"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Budget Status</h2>
        <div className="space-y-4">
          <Bar
            label="Medications"
            spent={spending?.spending.medications || 0}
            budget={spending?.policy.medicationMonthlyBudget || 300}
          />
          <Bar
            label="Medical Bills"
            spent={spending?.spending.bills || 0}
            budget={spending?.policy.billMonthlyBudget || 500}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Btn
            label="Compare Medication Prices"
            desc={
              agentPaused
                ? "Agent is paused"
                : "Find cheapest pharmacies for Rosa's 4 medications"
            }
            busy={(loading && activeTask === "meds") || agentPaused}
            onClick={() => onRunTask(TASKS.meds, "meds")}
          />
          <Btn
            label="Audit Hospital Bill"
            desc={
              agentPaused
                ? "Agent is paused"
                : "Scan Rosa's bill for errors and overcharges"
            }
            busy={(loading && activeTask === "bill") || agentPaused}
            onClick={() => onRunTask(TASKS.bill, "bill")}
          />
          <Btn
            label="Try Over-Budget Payment"
            desc={
              agentPaused
                ? "Agent is paused"
                : "Demo: agent attempts $600 payment (over $500 bill limit)"
            }
            busy={(loading && activeTask === "block") || agentPaused}
            onClick={() => onRunTask(TASKS.block, "block")}
          />
        </div>
        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-sky-600">
            <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
            Agent working...
          </div>
        )}
      </div>

      {agentResult && (
        <div
          className="bg-white rounded-xl border border-slate-200 p-6"
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Agent Response
          </h2>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">
            {agentResult.response}
          </p>
          <div className="mt-4 text-xs text-slate-400">
            {agentResult.toolCalls.length} tool calls | API cost: $
            {agentResult.spending.spending.serviceFees.toFixed(4)}
          </div>
        </div>
      )}
    </div>
  );
}
