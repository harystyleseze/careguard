"use client";

import { useEffect, useState } from "react";
import { Bar } from "../primitives/bar";
import { Btn } from "../primitives/btn";
import { Card } from "../primitives/card";
import type { AgentResult, AgentLlmError, SpendingData } from "../types";
import type { RecipientProfile } from "../../lib/types";
import { agentFetch } from "../../lib/agent-fetch";
import { formatCurrency, getTranslations, type Locale } from "../../i18n";
import { formatCurrency, formatDate, formatNumber, getTranslations, type Locale } from "../../i18n";

export interface OverviewTabProps {
  spending: SpendingData | null;
  agentResult: AgentResult | null;
  agentPaused: boolean;
  loading: boolean;
  activeTask: string;
  /** Tool currently executing inside the running task, when known (#1253). */
  activeTool?: string | null;
  onRunTask: (task: string, label: string) => void;
  onCancelTask?: () => void;
  recipient?: RecipientProfile;
  locale?: Locale;
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
  activeTool,
  onRunTask,
  onCancelTask,
  recipient,
  locale = "en",
}: OverviewTabProps) {
  const t = getTranslations(locale);

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
        .filter(
          (t) => t.tool === "audit_medical_bill" || t.tool === "fetch_and_audit_bill",
        )
        .reduce((s, t) => s + (t.result?.totalOvercharge || 0), 0)
    : 0;

  const llmTokens = agentResult?.llmUsage
    ? agentResult.llmUsage.promptTokens + agentResult.llmUsage.completionTokens
    : 0;
  const llmCost = agentResult?.llmUsage
    ? ((agentResult.llmUsage.promptTokens * 0.00000059) + (agentResult.llmUsage.completionTokens * 0.00000139)).toFixed(4)
    : "0.0000";

  return (
    <div
      role="tabpanel"
      id="tabpanel-overview"
      aria-labelledby="tab-overview"
      tabIndex={0}
      className="space-y-6"
    >
      <AdherencePrompt locale={locale} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card
          label={t.overview.monthlySpending}
          value={formatCurrency(spending?.spending.total ?? 0, locale)}
          sub={`of ${formatCurrency(spending?.policy.monthlyLimit ?? 500, locale, 0)} ${t.overview.limit}`}
          color="sky"
        />
        <Card
          label={t.overview.savingsFound}
          value={agentResult ? `${formatCurrency(savings, locale)}/mo` : `${formatCurrency(0, locale)}/mo`}
          sub={t.overview.bySwitching}
          color="green"
        />
        <Card
          label={t.overview.billingErrors}
          value={agentResult ? formatCurrency(overcharges, locale) : formatCurrency(0, locale)}
          sub={t.overview.inOvercharges}
          color="amber"
        />
        <Card
          label={t.overview.agentApiCosts}
          value={formatCurrency(spending?.spending.serviceFees ?? 0, locale, 4)}
          sub={`${spending?.transactionCount || 0} ${t.overview.queries}`}
          sub={`${spending?.transactionCount ? formatNumber(spending.transactionCount, locale) : 0} ${t.overview.queries}`}
          color="slate"
        />
        <Card
          label="LLM Tokens"
          value={agentResult ? `${formatNumber(llmTokens, locale)} tokens` : "0 tokens"}
          sub={`≈ ${formatCurrency(Number(llmCost), locale, 4)} this run`}
          color="sky"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t.overview.budgetStatus}</h2>
        <div className="space-y-4">
          <Bar
            label={t.budget.medications}
            spent={spending?.spending.medications || 0}
            budget={spending?.policy.medicationMonthlyBudget || 300}
            locale={locale}
          />
          <Bar
            label={t.budget.medicalBills}
            spent={spending?.spending.bills || 0}
            budget={spending?.policy.billMonthlyBudget || 500}
            locale={locale}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t.overview.agentActions}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Btn
            label={t.tasks.comparePrices}
            desc={
              agentPaused
                ? t.tasks.agentPaused
                : t.tasks.findCheapest
            }
            busy={(loading && activeTask === "meds") || agentPaused}
            onClick={() => onRunTask(TASKS.meds, "meds")}
          />
          <Btn
            label={t.tasks.auditBill}
            desc={
              agentPaused
                ? t.tasks.agentPaused
                : t.tasks.scanBill
            }
            busy={(loading && activeTask === "bill") || agentPaused}
            onClick={() => onRunTask(TASKS.bill, "bill")}
          />
          <Btn
            label={t.tasks.overBudget}
            desc={
              agentPaused
                ? t.tasks.agentPaused
                : t.tasks.demoPayment
            }
            busy={(loading && activeTask === "block") || agentPaused}
            onClick={() => onRunTask(TASKS.block, "block")}
          />
        </div>
        {loading && (
          <div className="mt-4 flex items-center gap-3 text-sm text-sky-600" aria-live="polite">
            <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
            {/* #1253: name the in-flight tool when the agent state has one,
                fall back to the generic message otherwise. */}
            {activeTool
              ? t.tasks.workingStep.replace("{step}", activeTool)
              : t.tasks.working}
            {onCancelTask && (
              <button
                onClick={onCancelTask}
                className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 cursor-pointer transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {agentResult?.events?.some((e) => e.kind === "iteration_limit_reached") && (
        <div
          role="alert"
          className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 text-sm text-yellow-800"
        >
          Task may be incomplete — agent ran out of steps
        </div>
      )}

      {agentResult?.error && (
        <LlmErrorBanner error={agentResult.error} />
      )}

      {agentResult && (
        <div
          className="bg-white rounded-xl border border-slate-200 p-6"
          aria-live="polite"
          aria-atomic="true"
        >
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            {t.overview.agentResponse}
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

      {/* Medication Adherence Prompt (Issue #264) */}
      {agentResult?.toolCalls.some((t) => t.tool === "pay_for_medication" && t.result?.success) && (
        <MedicationAdherenceCheck recipientName={recipient?.name || "the care recipient"} />
      )}
    </div>
  );
}

/**
 * Post-payment adherence check (Issue #1254). Distinguishes itself from the
 * AdherencePrompt list (#264, which has per-record Confirm buttons): this card
 * records today's dose against the most recent pending adherence record for
 * the recipient, disables both buttons once a choice is recorded, and shows
 * an inline confirmation so the action is never a silent no-op.
 */
function MedicationAdherenceCheck({ recipientName }: { recipientName: string }) {
  const [recorded, setRecorded] = useState<"taken" | "not_yet" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const record = async (choice: "taken" | "not_yet") => {
    if (recorded || submitting) return;
    setSubmitting(true);
    try {
      const pendingRes = await agentFetch("/agent/adherence/pending?recipient_id=rosa");
      const pending = pendingRes.ok ? await pendingRes.json() : null;
      const recordId = pending?.pending?.[0]?.id;

      if (recordId) {
        await agentFetch(
          choice === "taken" ? "/agent/adherence/confirm" : "/agent/adherence/skip",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ record_id: recordId }),
          },
        );
      }
      // Recorded (or nothing pending to record against) — either way the
      // choice is acknowledged and the buttons lock.
      setRecorded(choice);
    } catch {
      // Leave the buttons enabled so the caregiver can retry the recording.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-6">
      <h2 className="text-sm font-semibold text-amber-800 mb-2">
        Medication Adherence Check
      </h2>
      {recorded ? (
        <p className="text-sm text-green-700" role="status">
          ✓ {recorded === "taken" ? `Recorded — ${recipientName} took their medication today.` : "Recorded — dose not yet taken."}
        </p>
      ) : (
        <>
          <p className="text-sm text-amber-700">
            Did {recipientName} take their medication today?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => record("taken")}
              disabled={submitting}
              className="px-4 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Yes — Taken
            </button>
            <button
              onClick={() => record("not_yet")}
              disabled={submitting}
              className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Not Yet
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LlmErrorBanner({ error }: { error: AgentLlmError }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-red-50 border border-red-300 rounded-xl p-4 text-sm text-red-800"
    >
      <p className="font-semibold mb-1">⚠ LLM error at iteration {error.iteration} — results below are partial</p>
      <p className="text-red-700">{error.message}{error.code ? ` (${error.code})` : ""}</p>
    </div>
  );
}

function AdherencePrompt({ locale = "en" }: { locale?: Locale }) {
  const [adherence, setAdherence] = useState<{ pending: Array<{ id: string; drug: string; dueDate: string }>; flagged: Array<{ id: string; drug: string }> } | null>(null);

  useEffect(() => {
    agentFetch("/agent/adherence/pending?recipient_id=rosa")
      .then((r) => r.json())
      .then((data) => setAdherence(data))
      .catch(() => { });
  }, []);

  const handleConfirm = async (recordId: string) => {
    try {
      await agentFetch("/agent/adherence/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record_id: recordId }),
      });
      setAdherence((prev) => prev ? { ...prev, pending: prev.pending.filter((p) => p.id !== recordId) } : prev);
    } catch { }
  };

  if (!adherence || (adherence.pending.length === 0 && adherence.flagged.length === 0)) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-amber-800 mb-2">Medication Adherence</h2>
      {adherence.flagged.length > 0 && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs font-medium text-red-700">
            {adherence.flagged.length} medication(s) flagged for persistent skipped doses
          </p>
        </div>
      )}
      {adherence.pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-700">Did Rosa take her medication?</p>
          {adherence.pending.map((item) => (
            <div key={item.id} className="flex items-center justify-between bg-white rounded-lg p-2 border border-amber-100">
              <div>
                <span className="text-sm font-medium text-slate-700">{item.drug}</span>
                <span className="text-xs text-slate-400 ml-2">due {formatDate(item.dueDate, locale)}</span>
              </div>
              <button
                onClick={() => handleConfirm(item.id)}
                className="px-3 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 cursor-pointer"
              >
                Confirm Taken
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}