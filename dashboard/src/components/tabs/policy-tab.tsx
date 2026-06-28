"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { RecipientProfile } from "../../lib/types";
import {
  validatePolicy,
  type PolicyFieldError,
  type SpendingPolicyInput,
} from "../../lib/schemas";
import type { SpendingData } from "../types";
import { Toast } from "../primitives/toast";

const FIELDS: Array<[keyof SpendingPolicyInput, string]> = [
  ["dailyLimit", "Daily Spending Limit ($)"],
  ["monthlyLimit", "Monthly Spending Limit ($)"],
  ["medicationMonthlyBudget", "Medication Monthly Budget ($)"],
  ["billMonthlyBudget", "Bill Monthly Budget ($)"],
  ["approvalThreshold", "Caregiver Approval Threshold ($)"],
  ["holdTimeSeconds", "Hold Time Before Auto-Approval (seconds)"],
];

/** Per-field HTML input constraints — kept in sync with schemas.ts (#211). */
const FIELD_CONFIG: Record<
  keyof SpendingPolicyInput,
  { min: number; max: number; step: number }
> = {
  dailyLimit:              { min: 1, max: 50000, step: 1 },
  monthlyLimit:            { min: 1, max: 50000, step: 1 },
  medicationMonthlyBudget: { min: 1, max: 50000, step: 1 },
  billMonthlyBudget:       { min: 1, max: 50000, step: 1 },
  approvalThreshold:       { min: 1, max: 50000, step: 1 },
  holdTimeSeconds:         { min: 0, max: 86400, step: 1 },
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

const FIELD_LABELS: Record<string, string> = Object.fromEntries(FIELDS);

/** A confirmation step requires typing this word when a limit more than doubles. */
const TYPED_CONFIRMATION = "CONFIRM";

interface PolicyChangeRow {
  key: string;
  label: string;
  before: number;
  after: number;
  increased: boolean;
  doubled: boolean;
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
}

function errorFor(field: keyof SpendingPolicyInput, errors: PolicyFieldError[]) {
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
}: PolicyTabProps) {
  const validation = useMemo(() => validatePolicy(policyForm), [policyForm]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [confirmRows, setConfirmRows] = useState<PolicyChangeRow[] | null>(null);
  const [requiresTyped, setRequiresTyped] = useState(false);
  const [typedValue, setTypedValue] = useState("");

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

    const rows: PolicyChangeRow[] = LIMIT_FIELDS.map((key) => {
      const before = Number(baseline[key]);
      const after = Number(policyForm[key]);
      const increased =
        Number.isFinite(before) && Number.isFinite(after) && after > before;
      const doubled = increased && before > 0 && after > before * 2;
      return { key, label: FIELD_LABELS[key] ?? key, before, after, increased, doubled };
    }).filter((row) => row.before !== row.after);

    const increases = rows.filter((row) => row.increased);
    // Decreases (and unchanged limits) are the safe direction — save silently.
    if (increases.length === 0) {
      void persistPolicy();
      return;
    }

    setTypedValue("");
    setRequiresTyped(increases.some((row) => row.doubled));
    setConfirmRows(rows);
  }

  function cancelConfirm() {
    setConfirmRows(null);
    setRequiresTyped(false);
    setTypedValue("");
  }

  async function confirmSave() {
    setConfirmRows(null);
    setRequiresTyped(false);
    setTypedValue("");
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
      <h2 className="text-sm font-semibold text-slate-700 mb-4">
        Spending Policy for {recipient.name}
      </h2>
      <p className="text-xs text-slate-500 mb-6">
        These limits are enforced by Soroban smart contracts on Stellar. The
        agent cannot exceed them.
      </p>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {FIELDS.map(([key, label]) => {
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
                {label}
              </label>
              <input
                id={inputId}
                type="number"
                inputMode="decimal"
                min={FIELD_CONFIG[key].min}
                max={FIELD_CONFIG[key].max}
                step={FIELD_CONFIG[key].step}
                value={Number.isFinite(policyForm[key]) ? policyForm[key] : ""}
                aria-invalid={Boolean(errMsg)}
                aria-describedby={errMsg || warnMsg ? errorId : undefined}
                onChange={(e) => {
                  setPolicyDirty(true);
                  const raw = e.target.value;
                  const parsed = raw === "" ? Number.NaN : Number(raw);
                  setPolicyForm((p) => ({ ...p, [key]: parsed }));
                }}
                className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 ${
                  errMsg
                    ? "border-red-400 focus:ring-red-500"
                    : "border-slate-300 focus:ring-sky-500"
                }`}
              />
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
            </div>
          );
        })}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onForceSync}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition-all cursor-pointer"
          >
            Refresh from server
          </button>
          <button
            type="button"
            onClick={() => {
              if (spending?.policy) setPolicyForm(spending.policy);
              setPolicyDirty(false);
            }}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition-all cursor-pointer"
          >
            Discard changes
          </button>
        </div>
        <button
          type="submit"
          disabled={!validation.isValid}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            policySaved
              ? "bg-green-500 text-white"
              : "bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700"
          }`}
        >
          {policySaved ? "Policy Saved" : "Update Policy"}
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
            <p className="text-xs text-amber-700 mb-4">
              You are raising one or more limits. This increases your spending
              exposure — please review before saving.
            </p>

            <ul className="space-y-2 mb-4">
              {confirmRows.map((row) => (
                <li
                  key={row.key}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-mono">
                    <span className="text-slate-500">${row.before}</span>
                    <span className="mx-1 text-slate-400">&rarr;</span>
                    <span
                      className={
                        row.increased
                          ? "text-red-600 font-semibold"
                          : "text-green-600"
                      }
                    >
                      ${row.after}
                    </span>
                    {row.doubled && (
                      <span className="ml-1 text-red-600">(more than 2&times;)</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

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
