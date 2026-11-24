"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "careguard-recipient-wizard-draft";

type WizardStep = "info" | "medications" | "policy" | "wallet" | "summary";

type WizardState = {
  name: string;
  age: string;
  medications: string;
  primaryDoctor: string;
  insurance: string;
  dailyLimit: string;
  monthlyLimit: string;
  medicationMonthlyBudget: string;
  billMonthlyBudget: string;
  approvalThreshold: string;
  severityThreshold: string;
  walletFunding: string;
};

const initialState: WizardState = {
  name: "",
  age: "",
  medications: "Lisinopril, Metformin",
  primaryDoctor: "",
  insurance: "",
  dailyLimit: "100",
  monthlyLimit: "800",
  medicationMonthlyBudget: "300",
  billMonthlyBudget: "500",
  approvalThreshold: "75",
  severityThreshold: "any",
  walletFunding: "50",
};

const steps: Array<{ key: WizardStep; label: string }> = [
  { key: "info", label: "Recipient" },
  { key: "medications", label: "Medications" },
  { key: "policy", label: "Policy" },
  { key: "wallet", label: "Wallet" },
  { key: "summary", label: "Review" },
];

export function RecipientWizard({ onClose }: { onClose: () => void }) {
  const [currentStep, setCurrentStep] = useState<WizardStep>("info");
  const [draft, setDraft] = useState<WizardState>(initialState);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setDraft({ ...initialState, ...JSON.parse(raw) });
      } catch {
        // ignore malformed draft
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  const stepIndex = steps.findIndex((step) => step.key === currentStep);
  const currentStepDefinition = steps[stepIndex] ?? steps[0];
  const canContinue = useMemo(() => {
    if (currentStep === "info") return draft.name.trim().length > 0;
    if (currentStep === "medications") return draft.medications.trim().length > 0;
    if (currentStep === "policy") return Number(draft.dailyLimit) > 0 && Number(draft.monthlyLimit) > 0;
    if (currentStep === "wallet") return Number(draft.walletFunding) >= 0;
    return true;
  }, [currentStep, draft]);

  function updateField(field: keyof WizardState, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function submitWizard() {
    const recipientId = (draft.name || "new-recipient").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const medications = draft.medications.split(",").map((m) => m.trim()).filter(Boolean);
    const payload = {
      name: draft.name,
      age: Number(draft.age) || undefined,
      medications,
      doctor: draft.primaryDoctor,
      insurance: draft.insurance,
    };

    await fetch(`/agent/recipients/${recipientId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    await fetch(`/agent/policy?recipient_id=${encodeURIComponent(recipientId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyLimit: Number(draft.dailyLimit),
        monthlyLimit: Number(draft.monthlyLimit),
        medicationMonthlyBudget: Number(draft.medicationMonthlyBudget),
        billMonthlyBudget: Number(draft.billMonthlyBudget),
        approvalThreshold: Number(draft.approvalThreshold),
        holdTimeSeconds: 0,
        severityThreshold: draft.severityThreshold || "any",
      }),
    });

    window.localStorage.removeItem(STORAGE_KEY);
    onClose();
  }

  const advance = () => {
    if (!canContinue) return;
    const nextIndex = Math.min(stepIndex + 1, steps.length - 1);
    setCurrentStep(steps[nextIndex].key);
  };

  const goBack = () => {
    const prevIndex = Math.max(stepIndex - 1, 0);
    setCurrentStep(steps[prevIndex].key);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">New Recipient Wizard</h3>
            <p className="text-xs text-slate-500">Step {stepIndex + 1} of {steps.length}: {currentStepDefinition.label}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-700 text-sm">Close</button>
        </div>

        <div className="px-6 py-5">
          <div className="mb-6 flex gap-2">
            {steps.map((step, index) => (
              <div key={step.key} className={`flex-1 h-2 rounded-full ${index <= stepIndex ? "bg-sky-500" : "bg-slate-200"}`} />
            ))}
          </div>

          {currentStep === "info" && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="md:col-span-2 text-sm text-slate-700">
                Recipient name
                <input value={draft.name} onChange={(e) => updateField("name", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
              <label className="text-sm text-slate-700">
                Age
                <input type="number" value={draft.age} onChange={(e) => updateField("age", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
              <label className="text-sm text-slate-700">
                Insurance
                <input value={draft.insurance} onChange={(e) => updateField("insurance", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
              <label className="md:col-span-2 text-sm text-slate-700">
                Primary doctor
                <input value={draft.primaryDoctor} onChange={(e) => updateField("primaryDoctor", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
            </div>
          )}

          {currentStep === "medications" && (
            <div>
              <label className="text-sm text-slate-700">
                Medication list (comma-separated)
                <textarea value={draft.medications} onChange={(e) => updateField("medications", e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
            </div>
          )}

          {currentStep === "policy" && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700">Daily limit<input type="number" value={draft.dailyLimit} onChange={(e) => updateField("dailyLimit", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-sm text-slate-700">Monthly limit<input type="number" value={draft.monthlyLimit} onChange={(e) => updateField("monthlyLimit", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-sm text-slate-700">Medication budget<input type="number" value={draft.medicationMonthlyBudget} onChange={(e) => updateField("medicationMonthlyBudget", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-sm text-slate-700">Bill budget<input type="number" value={draft.billMonthlyBudget} onChange={(e) => updateField("billMonthlyBudget", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-sm text-slate-700">Approval threshold<input type="number" value={draft.approvalThreshold} onChange={(e) => updateField("approvalThreshold", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-sm text-slate-700">Interaction threshold
                <select value={draft.severityThreshold} onChange={(e) => updateField("severityThreshold", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="any">Any interaction</option>
                  <option value="major">Major/severe only</option>
                  <option value="moderate">Moderate or worse</option>
                  <option value="mild">Mild or worse</option>
                </select>
              </label>
            </div>
          )}

          {currentStep === "wallet" && (
            <div>
              <label className="text-sm text-slate-700">
                Initial wallet funding (USDC)
                <input type="number" value={draft.walletFunding} onChange={(e) => updateField("walletFunding", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </label>
            </div>
          )}

          {currentStep === "summary" && (
            <div className="space-y-3 text-sm text-slate-700">
              <div><span className="font-semibold">Name:</span> {draft.name}</div>
              <div><span className="font-semibold">Age:</span> {draft.age || "N/A"}</div>
              <div><span className="font-semibold">Medications:</span> {draft.medications}</div>
              <div><span className="font-semibold">Doctor:</span> {draft.primaryDoctor || "N/A"}</div>
              <div><span className="font-semibold">Insurance:</span> {draft.insurance || "N/A"}</div>
              <div><span className="font-semibold">Interaction threshold:</span> {draft.severityThreshold}</div>
              <div><span className="font-semibold">Wallet funding:</span> ${draft.walletFunding}</div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-6 py-4 flex justify-between">
          <button type="button" onClick={goBack} disabled={stepIndex === 0} className="px-4 py-2 text-sm rounded-lg bg-slate-100 text-slate-700 disabled:opacity-40">Back</button>
          {currentStep === "summary" ? (
            <button type="button" onClick={submitWizard} className="px-4 py-2 text-sm rounded-lg bg-sky-500 text-white">Create recipient</button>
          ) : (
            <button type="button" onClick={advance} disabled={!canContinue} className="px-4 py-2 text-sm rounded-lg bg-sky-500 text-white disabled:opacity-40">Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
