"use client";

import { useMemo, useState } from "react";
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
];

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
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (!validation.isValid) return;
          const result = await onUpdatePolicy();
          if (!result.ok) {
            setToastFallback(result.error || "Failed to update policy");
            setToastMsg("Policy update failed");
          }
        }}
        className="space-y-4"
      >
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
                min="0"
                max="10000"
                step="0.01"
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
      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onClose={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
    </div>
  );
}
