"use client";

import { useMemo, useState, useRef, useEffect, type FormEvent } from "react";
import type { RecipientProfile } from "../../lib/types";
import {
  validatePolicy,
  type PolicyFieldError,
  type SpendingPolicyInput,
} from "../../lib/schemas";
import { POLICY_FIELD_T_KEY as FIELD_T_KEY } from "../../lib/policy-field-labels";
import type { SpendingData } from "../types";
import { Bar } from "../primitives/bar";
import { Toast } from "../primitives/toast";
import { ContextualHelp } from "../primitives/contextual-help";
import { getTranslations, type Locale } from "../../i18n";
import { agentFetch } from "../../lib/agent-fetch";

const FIELDS: Array<[keyof SpendingPolicyInput, string]> = [
  ["dailyLimit", "Daily Spending Limit ($)"],
  ["monthlyLimit", "Monthly Spending Limit ($)"],
  ["medicationMonthlyBudget", "Medication Monthly Budget ($)"],
  ["billMonthlyBudget", "Bill Monthly Budget ($)"],
  ["approvalThreshold", "Caregiver Approval Threshold ($)"],
  ["holdTimeSeconds", "Hold Time Before Auto-Approval (seconds)"],
  ["warningThresholdPct", "Budget Warning Threshold (%)"],
];

/** Helper text for fields (#1270) — real-world context to guide non-technical caregivers. */
const FIELD_HELPERS: Record<string, string> = {
  dailyLimit: "Typical daily medication costs range from $20–$50. Medical appointments and procedures vary widely.",
  monthlyLimit: "Most households budget $800–$1,500/month for combined medications, bills, and copayments.",
  medicationMonthlyBudget: "Common medications average $100–$300/month. Multi-drug regimens may run higher.",
  billMonthlyBudget: "Routine medical bills (copays, labs) average $100–$400/month; major procedures cost more.",
  approvalThreshold: "Set this to flag payments above a certain amount for your manual review before they go through.",
};

/** Per-field HTML input constraints — kept in sync with schemas.ts (#211). */
const FIELD_CONFIG: Record<
  keyof SpendingPolicyInput,
  { min?: number; max?: number; step?: number }
> = {
  dailyLimit: { min: 1, max: 50000, step: 1 },
  monthlyLimit: { min: 1, max: 50000, step: 1 },
  medicationMonthlyBudget: { min: 1, max: 50000, step: 1 },
  billMonthlyBudget: { min: 1, max: 50000, step: 1 },
  approvalThreshold: { min: 1, max: 50000, step: 1 },
  holdTimeSeconds: { min: 0, max: 86400, step: 1 },
  warningThresholdPct: { min: 1, max: 99, step: 1 },
};

/** Optional helper hints shown below specific fields. */
const FIELD_HINT: Partial<Record<keyof SpendingPolicyInput, string>> = {
  warningThresholdPct:
    "Sends a notification when spending reaches this % of a budget. The transaction still proceeds — this is a soft alert, not a hard block. Default: 80.",
  holdTimeSeconds: "0 = auto-approve immediately. Max 86400 (24 h).",
};

/**
 * Limit fields whose increase raises the caregiver's spending exposure and
 * therefore warrants a confirmation step (Issue #216). holdTimeSeconds is
 * excluded — a longer hold is the safe direction.
 */
const LIMIT_FIELDS: Array<keyof SpendingPolicyInput> = [
  "dailyLimit",
  "monthlyLimit",
  "medicationMonthlyBudget",
  "billMonthlyBudget",
  "approvalThreshold",
];


/** A confirmation step requires typing this word when a limit more than doubles. */
const TYPED_CONFIRMATION = "CONFIRM";

interface PolicyChangeRow {
  key: string;
  label: string;
  before: number;
  after: number;
  increased: boolean;
  doubled: boolean;
  delta?: number;
}

type PolicyOutcome = "allowed" | "requires_approval" | "blocked";

/** Response of POST /agent/policy/preview (#1238). */
export interface PolicyImpact {
  evaluated: number;
  newlyBlocked: number;
  newlyAllowed: number;
  approvalChanged: number;
  entries: Array<{
    id: string;
    timestamp: string;
    description: string;
    amount: number;
    before: PolicyOutcome;
    after: PolicyOutcome;
    changed: boolean;
  }>;
}

type ImpactState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; impact: PolicyImpact };

const OUTCOME_LABEL: Record<PolicyOutcome, string> = {
  allowed: "allowed",
  requires_approval: "needs approval",
  blocked: "blocked",
};

/** One-line summary of how the change would have treated recent payments. */
export function describePolicyImpact(impact: PolicyImpact): string {
  const n = impact.evaluated;
  if (n === 0) return "There are no recent payments to compare this change against yet.";
  const of = `of the last ${n} payment${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (impact.newlyBlocked > 0) parts.push(`would have blocked ${impact.newlyBlocked} ${of}`);
  if (impact.newlyAllowed > 0) parts.push(`would have allowed ${impact.newlyAllowed} ${of} that were blocked`);
  if (impact.approvalChanged > 0) {
    parts.push(`would have changed the approval requirement for ${impact.approvalChanged}`);
  }
  if (parts.length === 0) return `This change would not have affected any ${of}.`;
  return `This change ${parts.join("; ")}.`;
}

async function fetchPolicyImpact(policy: SpendingPolicyInput): Promise<PolicyImpact> {
  const res = await agentFetch("/agent/policy/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (!res.ok) throw new Error(`preview failed (${res.status})`);
  const body = await res.json();
  if (!body?.impact || typeof body.impact.evaluated !== "number") {
    throw new Error("malformed preview");
  }
  return body.impact as PolicyImpact;
}

function formatPolicyValue(key: string, value: number): string {
  return key === "holdTimeSeconds" ? `${value}s` : `$${value}`;
}

function getImpactExplanation(rows: PolicyChangeRow[]): string {
  const increases = rows.filter((r) => r.increased);
  if (increases.length === 0) return "";

  const deltas = increases.map((row) => {
    const delta = row.after - row.before;
    if (row.key === "monthlyLimit") {
      return `the monthly limit by $${delta.toFixed(2)}`;
    } else if (row.key === "medicationMonthlyBudget") {
      return `the medication budget by $${delta.toFixed(2)}`;
    } else if (row.key === "billMonthlyBudget") {
      return `the bill budget by $${delta.toFixed(2)}`;
    } else if (row.key === "dailyLimit") {
      const monthlyDelta = delta * 30;
      return `the daily limit by $${delta.toFixed(2)} (up to $${monthlyDelta.toFixed(2)}/month)`;
    } else if (row.key === "approvalThreshold") {
      return `the approval threshold by $${delta.toFixed(2)}`;
    }
    return "";
  }).filter(Boolean);

  if (deltas.length === 0) return "";
  if (deltas.length === 1) {
    return `In practice, this increases ${deltas[0]} without requiring your approval first.`;
  }
  return `In practice, this increases: ${deltas.join(", ")} — all without requiring your approval first.`;
}

export interface PolicyTabProps {
  recipient: RecipientProfile;
  policyForm: SpendingPolicyInput;
  setPolicyForm: (
    updater:
      | SpendingPolicyInput
      | ((prev: SpendingPolicyInput) => SpendingPolicyInput),
  ) => void;
  setPolicyDirty: (dirty: boolean) => void;
  spending: SpendingData | null;
  policySaved: boolean;
  onUpdatePolicy: () => Promise<{ ok: boolean; error?: string }>;
  onForceSync: () => void;
  locale?: Locale;
}

function errorFor(
  field: keyof SpendingPolicyInput,
  errors: PolicyFieldError[],
) {
  return errors.find((e) => e.field === field)?.message;
}

export function PolicyTab({
  recipient,
  policyForm,
  setPolicyForm,
  setPolicyDirty,
  spending,
  policySaved,
  onUpdatePolicy,
  onForceSync,
  locale = "en",
}: PolicyTabProps) {
  const t = getTranslations(locale);
  const validation = useMemo(() => validatePolicy(policyForm), [policyForm]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(
    undefined,
  );
  const [confirmRows, setConfirmRows] = useState<PolicyChangeRow[] | null>(
    null,
  );
  const [requiresTyped, setRequiresTyped] = useState(false);
  const [typedValue, setTypedValue] = useState("");
  const [impactState, setImpactState] = useState<ImpactState | null>(null);
  const previewSeq = useRef(0);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

  const baseline = spending?.policy;

  async function persistPolicy() {
    const result = await onUpdatePolicy();
    if (!result.ok) {
      setToastFallback(result.error || "Failed to update policy");
      setToastMsg("Policy update failed");
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validation.isValid) return;

    // Without a saved baseline to diff against, save directly.
    if (!baseline) {
      void persistPolicy();
      return;
    }

    const rows: PolicyChangeRow[] = FIELDS.map((key) => {
      const before = Number(baseline[key]);
      const after = Number(policyForm[key]);
      // Only raised spending limits add exposure; a longer hold is safe (#216).
      const increased =
        LIMIT_FIELDS.includes(key) &&
        Number.isFinite(before) && Number.isFinite(after) && after > before;
      const doubled = increased && before > 0 && after > before * 2;
      return {
        key,
        label: FIELD_LABELS[key] ?? key,
        before,
        after,
        increased,
        doubled,
      };
    }).filter((row) => row.before !== row.after);

    // Nothing changed — there is nothing to preview.
    if (rows.length === 0) {
      void persistPolicy();
      return;
    }

    // #1238: every change goes through the old-vs-new preview, with an
    // estimate of how it would have treated recent payments, before saving.
    setTypedValue("");
    setRequiresTyped(rows.some((row) => row.doubled));
    setConfirmRows(rows);
    const seq = ++previewSeq.current;
    setImpactState({ status: "loading" });
    fetchPolicyImpact(policyForm)
      .then((impact) => {
        if (previewSeq.current === seq) setImpactState({ status: "ready", impact });
      })
      .catch(() => {
        if (previewSeq.current === seq) setImpactState({ status: "error" });
      });
  }

  function closePreview() {
    previewSeq.current++;
    setConfirmRows(null);
    setRequiresTyped(false);
    setTypedValue("");
    setImpactState(null);
  }

  function cancelConfirm() {
    closePreview();
  }

  async function confirmSave() {
    closePreview();
    await persistPolicy();
  }

  return (
    <div
      role="tabpanel"
      id="tabpanel-policy"
      aria-labelledby="tab-policy"
      tabIndex={0}
      className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center">
          {t.policy.title.replace("Rosa", recipient.name)}
          <ContextualHelp topicKey="policy_block" caregiverId="caregiver" />
        </h2>
      </div>
      <p className="text-xs text-slate-500 mb-6">
        These limits are enforced server-side by the CareGuard agent before
        every payment.
      </p>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {FIELDS.map((key) => {
          const label = t.policy[FIELD_T_KEY[key] as keyof typeof t.policy];
          const errMsg = errorFor(key, validation.errors);
          const warnMsg = errorFor(key, validation.warnings);
          const inputId = `policy-${key}`;
          const errorId = `${inputId}-error`;
          return (
            <div key={key}>
              <label
                htmlFor={inputId}
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                <span className="inline-flex items-center">
                  {label}
                  {key === "approvalThreshold" && (
                    <ContextualHelp topicKey="approval_threshold" caregiverId="caregiver" />
                  )}
                  {key === "dailyLimit" && (
                    <ContextualHelp topicKey="policy_block" caregiverId="caregiver" />
                  )}
                </span>
              </label>
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                min={FIELD_CONFIG[key].min}
                max={FIELD_CONFIG[key].max}
                step={FIELD_CONFIG[key].step}
                value={
                  Number.isFinite(policyForm[key] as number)
                    ? policyForm[key]
                    : ""
                }
                aria-invalid={Boolean(errMsg)}
                aria-describedby={errMsg || warnMsg ? errorId : undefined}
                onChange={(e) => {
                  setPolicyDirty(true);
                  const raw = e.target.value;
                  const parsed = raw === "" ? Number.NaN : Number(raw);
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  debounceRef.current = setTimeout(() => {
                    setPolicyForm((p) => ({ ...p, [key]: parsed }));
                  }}
                  className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
                    errMsg
                      ? "border-red-400 focus:ring-red-500"
                      : "border-slate-300 focus:ring-sky-500"
                  }`}
                />
              )}
              {errMsg && (
                <p id={errorId} className="mt-1 text-xs text-red-600">
                  {errMsg}
                </p>
              )}
              {!errMsg && warnMsg && (
                <p id={errorId} className="mt-1 text-xs text-amber-600">
                  Warning: {warnMsg}
                </p>
              )}
              {!errMsg && !warnMsg && FIELD_HINT[key] && (
                <p className="mt-1 text-xs text-slate-400">{FIELD_HINT[key]}</p>
              )}
            </div>
            <div className="space-y-3">
              <Bar
                label={t.budget.medications}
                spent={spending.spending.medications}
                budget={Number(policyForm.medicationMonthlyBudget)}
                locale={locale}
              />
              <Bar
                label={t.budget.medicalBills}
                spent={spending.spending.bills}
                budget={Number(policyForm.billMonthlyBudget)}
                locale={locale}
              />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={onForceSync}
              title={t.policy.refreshHint}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition-all cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              {t.policy.refresh}
            </button>
            <span className="text-[10px] text-slate-400 text-center">
              {t.policy.refreshHint}
            </span>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                if (spending?.policy) setPolicyForm(spending.policy);
                setPolicyDirty(false);
              }}
              title={t.policy.discardHint}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition-all cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                />
              </svg>
              {t.policy.discard}
            </button>
            <span className="text-[10px] text-slate-400 text-center">
              {t.policy.discardHint}
            </span>
          </div>
        </div>
        <button
          type="submit"
          disabled={!validation.isValid}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors duration-700 ease-in-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${policySaved
              ? "bg-green-500 text-white"
              : "bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700"
            }`}
        >
          {policySaved ? t.policy.policySaved : t.policy.updatePolicy}
        </button>
      </form>
      {confirmRows && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="policy-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={cancelConfirm}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="policy-confirm-title"
              className="text-sm font-semibold text-slate-800 mb-1"
            >
              Confirm policy change
            </h3>
            {confirmRows.some((row) => row.increased) ? (
              <p className="text-xs text-amber-700 mb-2">
                You are raising one or more limits. This increases your spending
                exposure — please review before saving.
              </p>
            ) : (
              <p className="text-xs text-slate-600 mb-2">
                Review how this change compares with your current policy before saving.
              </p>
            )}
            {getImpactExplanation(confirmRows) && (
              <p className="text-xs text-slate-700 mb-4 p-2 bg-amber-50 rounded border border-amber-200">
                {getImpactExplanation(confirmRows)}
              </p>
            )}

            <ul className="space-y-2 mb-4">
              {confirmRows.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-mono">
                    <span className="text-slate-500">{formatPolicyValue(row.key, row.before)}</span>
                    <span className="mx-1 text-slate-400">&rarr;</span>
                    <span
                      className={
                        row.increased
                          ? "text-red-600 font-semibold"
                          : "text-green-600"
                      }
                    >
                      {formatPolicyValue(row.key, row.after)}
                    </span>
                    {row.doubled && (
                      <span className="ml-1 text-red-600">
                        (more than 2&times;)
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div
              aria-live="polite"
              data-testid="policy-impact"
              className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"
            >
              <p className="font-semibold text-slate-700 mb-1">
                Impact on recent payments
              </p>
              {(!impactState || impactState.status === "loading") && (
                <p className="text-slate-500">Checking recent payments…</p>
              )}
              {impactState?.status === "error" && (
                <p className="text-slate-500">
                  Couldn&apos;t estimate the impact right now. You can still save the change.
                </p>
              )}
              {impactState?.status === "ready" && (
                <>
                  <p className="text-slate-700">{describePolicyImpact(impactState.impact)}</p>
                  {impactState.impact.newlyBlocked > 0 && (
                    <ContextualHelp topicKey="policy_block" variant="inline" className="mt-2 mb-2" />
                  )}
                  {impactState.impact.entries.some((e) => e.changed) && (
                    <ul className="mt-2 space-y-1">
                      {impactState.impact.entries
                        .filter((e) => e.changed)
                        .slice(0, 5)
                        .map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-2">
                            <span className="truncate text-slate-600">
                              {e.description} (${e.amount.toFixed(2)})
                            </span>
                            <span className="shrink-0 font-mono">
                              <span className="text-slate-500">{OUTCOME_LABEL[e.before]}</span>
                              <span className="mx-1 text-slate-400">&rarr;</span>
                              <span
                                className={
                                  e.after === "blocked" ? "text-red-600 font-semibold" : "text-green-700"
                                }
                              >
                                {OUTCOME_LABEL[e.after]}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            {requiresTyped && (
              <div className="mb-4">
                <label
                  htmlFor="policy-confirm-typed"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  This more than doubles a limit. Type {TYPED_CONFIRMATION} to
                  confirm.
                </label>
                <input
                  id="policy-confirm-typed"
                  type="text"
                  value={typedValue}
                  onChange={(e) => setTypedValue(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancelConfirm}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSave}
                disabled={requiresTyped && typedValue !== TYPED_CONFIRMATION}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                Confirm &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onDismiss={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
    </div>
  );
}
