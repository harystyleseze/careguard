"use client";

import { useEffect, useState } from "react";
import { downloadMedicationPDF } from "../../app/pdf";
import {
  DrugInteractionResultSchema,
  PharmacyCompareResultSchema,
  type RecipientProfile,
  type Transaction,
  ORDER_STATUS,
  type Vital,
  type RecipientAllergy,
  type AllergySeverity,
  type CaregiverProfile,
  type ConsentSettings,
} from "../../lib/types";
import type { AgentResult } from "../types";
import { VitalsSection } from "../vitals-section";
import { InteractionHistorySection } from "../interaction-history-section";
import { getTranslations, type Locale } from "../../i18n";
import { AGENT_URL } from "../../lib/agent-url";
import { agentFetch } from "../../lib/agent-fetch";
import { ContextualHelp } from "../primitives/contextual-help";

const DEFAULT_MEDS = ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"] as const;

type SideEffectEntry = {
  id: string;
  recipientId: string;
  medicationId: string;
  description: string;
  severity: "mild" | "moderate" | "severe";
  timestamp: string;
};

const DEFAULT_SIDE_EFFECT_FORM = {
  description: "",
  severity: "mild" as const,
};

export interface MedicationsTabProps {
  agentResult: AgentResult | null;
  recipient: RecipientProfile;
  /** All medication transactions — used to show order lifecycle status. */
  allTransactions?: Transaction[];
  locale?: Locale;
  currentCaregiver?: CaregiverProfile;
  consentSettings?: ConsentSettings;
}

export function MedicationsTab({
  agentResult,
  recipient,
  allTransactions = [],
  locale = "en",
  currentCaregiver,
  consentSettings,
}: MedicationsTabProps) {
  // Find the most recent medication order for each drug name
  const latestOrderByDrug = allTransactions
    .filter((tx) => tx.type === "medication" && tx.order_status)
    .reduce<Record<string, Transaction>>((acc, tx) => {
      const key = tx.description.split(" from ")[0].toLowerCase();
      if (!acc[key] || new Date(tx.timestamp) > new Date(acc[key].timestamp)) {
        acc[key] = tx;
      }
      return acc;
    }, {});

  const isRestricted =
    currentCaregiver &&
    currentCaregiver.role &&
    currentCaregiver.role !== "owner" &&
    consentSettings &&
    consentSettings[currentCaregiver.role]?.medications === false;

  const t = getTranslations(locale).medications;
  const [vitals, setVitals] = useState<Vital[]>([]);
  const hasPriceResults = agentResult?.toolCalls.some(
    (tc) => tc.tool === "compare_pharmacy_prices",
  );
  const interactionCalls = agentResult?.toolCalls.filter(
    (tc) => tc.tool === "check_drug_interactions",
  );
  const medications = Array.from(new Set([...(recipient.medications ?? []), ...MEDS]));
  const storageKey = `careguard-side-effects-${recipient.name?.toLowerCase().replace(/\s+/g, "-") || "recipient"}`;
  const [entries, setEntries] = useState<Record<string, SideEffectEntry[]>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [forms, setForms] = useState<Record<string, typeof DEFAULT_SIDE_EFFECT_FORM>>(() =>
    Object.fromEntries(medications.map((med) => [med, { ...DEFAULT_SIDE_EFFECT_FORM }]))
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, JSON.stringify(entries));
    }
  }, [entries, storageKey]);

  function addEntry(medicationId: string) {
    const value = forms[medicationId]?.description?.trim();
    if (!value) return;
    const nextEntry: SideEffectEntry = {
      id: `${medicationId}-${Date.now()}`,
      recipientId: recipient.name,
      medicationId,
      description: value,
      severity: forms[medicationId]?.severity ?? "mild",
      timestamp: new Date().toISOString(),
    };
    setEntries((prev) => ({
      ...prev,
      [medicationId]: [...(prev[medicationId] ?? []), nextEntry].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ),
    }));
    setForms((prev) => ({
      ...prev,
      [medicationId]: { ...DEFAULT_SIDE_EFFECT_FORM },
    }));
  }

  // --- Allergies State (Issue #1230) ---
  const [allergies, setAllergies] = useState<RecipientAllergy[]>([
    {
      id: "allergy-initial-penicillin",
      substance: "Penicillin",
      severity: "severe",
      reaction: "Anaphylaxis / Hives",
      notes: "Diagnosed 2018. Strictly avoid penicillin-class antibiotics.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [loadingAllergies, setLoadingAllergies] = useState(false);
  const [isAddingAllergy, setIsAddingAllergy] = useState(false);
  const [substance, setSubstance] = useState("");
  const [severity, setSeverity] = useState<AllergySeverity>("severe");
  const [reaction, setReaction] = useState("");
  const [notes, setNotes] = useState("");

  // --- Medication Addition & Allergy Check Test (Issue #1230) ---
  const [candidateMed, setCandidateMed] = useState("");
  const [optOutMeds, setOptOutMeds] = useState<string[]>([]);

  // --- Medication Dosage History State & Actions (Issue #1227) ---
  const [dosageHistory, setDosageHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedHistoryDrug, setExpandedHistoryDrug] = useState<string | null>(null);
  const [adjustingDrug, setAdjustingDrug] = useState<string | null>(null);
  const [newDosageInput, setNewDosageInput] = useState("");
  const [newFrequencyInput, setNewFrequencyInput] = useState("");
  const [dosageReasonInput, setDosageReasonInput] = useState("");
  const [prescriberInput, setPrescriberInput] = useState("");
  const [savingDosage, setSavingDosage] = useState(false);

  // Fetch allergies from backend on load
  useEffect(() => {
    let isMounted = true;
    async function fetchAllergies() {
      try {
        if (!isMounted) return;
        setLoadingAllergies(true);
        const res = await agentFetch(`${AGENT_URL}/agent/allergies?recipient_id=rosa`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (Array.isArray(data.allergies) && data.allergies.length > 0 && isMounted) {
            setAllergies(data.allergies);
          }
        }
      } catch {
        // Fall back to local default state
      } finally {
        if (isMounted) setLoadingAllergies(false);
      }
    }

    async function fetchDosageHistory() {
      try {
        if (!isMounted) return;
        setLoadingHistory(true);
        const res = await agentFetch(`${AGENT_URL}/agent/medications/history?recipient_id=rosa`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (Array.isArray(data.history) && isMounted) {
            setDosageHistory(data.history);
          }
        }
      } catch {
        // Fallback
      } finally {
        if (isMounted) setLoadingHistory(false);
      }
    }

    fetchAllergies();
    fetchDosageHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSaveDosageChange = async (drugName: string) => {
    if (!newDosageInput.trim() || !newFrequencyInput.trim()) {
      toast.error("Dosage and frequency are required");
      return;
    }
    setSavingDosage(true);
    try {
      const res = await agentFetch(`${AGENT_URL}/agent/medications/dosage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: "rosa",
          medicationName: drugName,
          newDosage: newDosageInput.trim(),
          newFrequency: newFrequencyInput.trim(),
          reason: dosageReasonInput.trim() || undefined,
          prescriber: prescriberInput.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.entry) {
          setDosageHistory((prev) => [data.entry, ...prev]);
        }
        toast.success(`Recorded new dosage for ${drugName}`);
        setAdjustingDrug(null);
        setNewDosageInput("");
        setNewFrequencyInput("");
        setDosageReasonInput("");
        setPrescriberInput("");
      } else {
        toast.error("Failed to save dosage change");
      }
    } catch {
      toast.error("Network error while recording dosage change");
    } finally {
      setSavingDosage(false);
    }
  };

  // Save new allergy
  const handleAddAllergy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!substance.trim()) {
      toast.error("Please specify the allergen substance");
      return;
    }
    const newEntry: RecipientAllergy = {
      id: `allergy-${Date.now()}`,
      substance: substance.trim(),
      severity,
      reaction: reaction.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setAllergies((prev) => [...prev, newEntry]);
    setIsAddingAllergy(false);
    setSubstance("");
    setReaction("");
    setNotes("");

    try {
      await agentFetch(`${AGENT_URL}/agent/allergies`, {
        method: "POST",
        body: JSON.stringify(newEntry),
      });
      toast.success(`Added allergy record for ${newEntry.substance}`);
    } catch {
      toast.success(`Saved allergy record locally for ${newEntry.substance}`);
    }
  };

  // Remove allergy
  const handleRemoveAllergy = async (id: string, name: string) => {
    setAllergies((prev) => prev.filter((a) => a.id !== id));
    try {
      await agentFetch(`${AGENT_URL}/agent/allergies/${id}`, { method: "DELETE" });
    } catch {
      // Local removal succeeded
    }
    toast.success(`Removed allergy: ${name}`);
  };

  // Check candidate medication against allergy list
  const allergyCheck = useMemo(() => {
    if (!candidateMed.trim()) return null;
    const medLower = candidateMed.toLowerCase().trim();

    // Check cross-reactivity
    for (const allergy of allergies) {
      const aLower = allergy.substance.toLowerCase().trim();
      const isDirectMatch = medLower.includes(aLower) || aLower.includes(medLower);
      const isPenicillinCross =
        aLower.includes("penicillin") &&
        (medLower.includes("amoxicillin") ||
          medLower.includes("ampicillin") ||
          medLower.includes("augmentin") ||
          medLower.includes("penicillin"));

      if (isDirectMatch || isPenicillinCross) {
        const isBlocked = allergy.severity === "severe" || allergy.severity === "life_threatening";
        return {
          matched: true,
          blocked: isBlocked,
          allergy,
          message: isBlocked
            ? `BLOCKED: Patient has documented ${allergy.severity.replace("_", "-")} allergy to ${allergy.substance} (${allergy.reaction || "Adverse reaction"}). Adding this medication is contraindicated.`
            : `WARNING: Documented ${allergy.severity} sensitivity to ${allergy.substance}. Monitor closely.`,
        };
      }
    }

    return {
      matched: false,
      blocked: false,
      message: `Safe: No documented allergy conflicts found for "${candidateMed}".`,
    };
  }, [candidateMed, allergies]);

  // Toggle Price Watch Opt-Out (Issue #1236)
  const toggleOptOut = (drug: string) => {
    setOptOutMeds((prev) => {
      const isOptedOut = prev.includes(drug);
      const updated = isOptedOut ? prev.filter((d) => d !== drug) : [...prev, drug];
      toast.info(
        isOptedOut
          ? `Enabled price watch alerts for ${drug}`
          : `Opted out of price watch alerts for ${drug}`,
      );
      return updated;
    });
  };

  if (isRestricted) {
    return (
      <div
        role="tabpanel"
        id="tabpanel-medications"
        aria-labelledby="tab-medications"
        tabIndex={0}
        className="space-y-6"
      >
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center max-w-xl mx-auto my-12">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
              />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-amber-900">
            Access Restricted by Care Recipient
          </h3>
          <p className="mt-2 text-sm text-amber-700">
            Consent settings for {recipient.name} restrict viewing medication records for {currentCaregiver.role} caregivers.
          </p>
          <p className="mt-1 text-xs text-amber-600">
            Contact the primary caregiver to adjust data-sharing permissions in Settings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="tabpanel"
      id="tabpanel-medications"
      aria-labelledby="tab-medications"
      tabIndex={0}
      className="space-y-6"
    >
      {/* ── Active Medications & Price Comparison ──────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">{t.title}</h2>
              <ContextualHelp topicKey="dosage_history" caregiverId="caregiver" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Active recurring medications with automated price watch monitoring & versioned dosage history
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
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
                    sideEffectEntries: Object.values(entries).flat(),
                  },
                  { recipient },
                );
              }}
              disabled={!hasPriceResults}
              title={hasPriceResults ? undefined : t.downloadPdfHint}
              aria-describedby={!hasPriceResults ? "medications-download-hint" : undefined}
              className="px-3 py-1.5 bg-sky-50 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-100 active:bg-sky-200 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-sky-50"
            >
              {t.downloadPdf}
            </button>
            {!hasPriceResults && (
              <span id="medications-download-hint" className="text-[10px] text-slate-400">
                {t.downloadPdfHint}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {medications.map((drug) => {
            const r = agentResult?.toolCalls.find(
              (tc) =>
                tc.tool === "compare_pharmacy_prices" &&
                tc.result?.drug?.toLowerCase() === drug.toLowerCase(),
            )?.result;
            const drugEntries = entries[drug] ?? [];
            return (
              <div
                key={drug}
                className="p-4 bg-slate-50 rounded-lg space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{drug}</div>
                    <div className="text-xs text-slate-500">
                      {r
                        ? `Best: ${r.cheapest.pharmacyName} at $${r.cheapest.price}`
                        : "Not yet compared"}
                    </div>
                  </div>
                  {r && (
                    <div className="text-right">
                      <div className="text-sm font-medium text-green-600">
                        Save ${r.potentialSavings}/mo
                      </div>
                      <div className="text-xs text-slate-400">
                        {r.savingsPercent}% savings
                      </div>
                    </div>
                  )}
                </div>

                {/* Insurance network check (#1234): explain, don't just badge. */}
                {r?.network?.configured && r.network.outOfNetworkCount > 0 && (
                  <div
                    role="note"
                    data-testid={`network-note-${drug}`}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                  >
                    <p className="font-semibold">
                      {r.cheapest?.networkStatus === "out_of_network"
                        ? "Cheapest pharmacy is out-of-network"
                        : `${r.network.outOfNetworkCount} out-of-network pharmac${r.network.outOfNetworkCount === 1 ? "y" : "ies"}`}
                    </p>
                    <p className="mt-1">{r.network.explanation}</p>
                    {r.cheapest?.networkNote && <p className="mt-1 text-amber-800">{r.cheapest.networkNote}</p>}
                  </div>
                )}

                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Side effect journal
                  </div>
                  <div className="grid grid-cols-[1fr_120px_auto] gap-2">
                    <input
                      aria-label={`Side effect description for ${drug}`}
                      value={forms[drug]?.description ?? ""}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [drug]: {
                            ...(prev[drug] ?? DEFAULT_SIDE_EFFECT_FORM),
                            description: e.target.value,
                          },
                        }))
                      }
                      placeholder="Describe observed side effects"
                      className="px-2 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    <select
                      aria-label={`Severity for ${drug}`}
                      value={forms[drug]?.severity ?? "mild"}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [drug]: {
                            ...(prev[drug] ?? DEFAULT_SIDE_EFFECT_FORM),
                            severity: e.target.value as "mild" | "moderate" | "severe",
                          },
                        }))
                      }
                      className="px-2 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      <option value="mild">Mild</option>
                      <option value="moderate">Moderate</option>
                      <option value="severe">Severe</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => addEntry(drug)}
                      className="px-2.5 py-1.5 rounded-md bg-sky-500 text-white text-xs font-medium hover:bg-sky-600"
                    >
                      Save
                    </button>
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {drug}
                    {latestOrderByDrug[drug.toLowerCase()]?.order_status && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          latestOrderByDrug[drug.toLowerCase()].order_status ===
                          "picked_up"
                            ? "bg-green-100 text-green-700"
                            : latestOrderByDrug[drug.toLowerCase()]
                                  .order_status === "ready"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {latestOrderByDrug[drug.toLowerCase()].order_status ===
                        "picked_up"
                          ? "✓ Picked up"
                          : latestOrderByDrug[drug.toLowerCase()]
                                .order_status === "ready"
                            ? "⏳ Ready for pickup"
                            : "📦 Submitted"}
                      </span>
                    )}
                  </div>

                  {drugEntries.length > 0 ? (
                    <ul className="space-y-2">
                      {drugEntries.map((entry) => (
                        <li key={entry.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                            <span>{new Date(entry.timestamp).toLocaleDateString()}</span>
                            <span className={`px-1.5 py-0.5 rounded-full ${entry.severity === "severe" ? "bg-red-100 text-red-700" : entry.severity === "moderate" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {entry.severity}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-700">{entry.description}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-slate-500">No side effects logged yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <VitalsSection locale={locale} onVitalsChange={setVitals} />
      <InteractionHistorySection />

      {/* ── Documented Allergies & Adverse Reactions (Issue #1230) ─────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">
                Allergies & Adverse Reactions
              </h2>
              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                {allergies.length} Documented
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Independent safety record consulted before any new medication is ordered or added
            </p>
          </div>
          <button
            onClick={() => setIsAddingAllergy(!isAddingAllergy)}
            className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-xs font-medium cursor-pointer transition-all"
          >
            {isAddingAllergy ? "Cancel" : "+ Add Allergy Record"}
          </button>
        </div>

        {/* Add Allergy Inline Form */}
        {isAddingAllergy && (
          <form
            onSubmit={handleAddAllergy}
            className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Substance / Drug Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Penicillin, Sulfa, Aspirin"
                  value={substance}
                  onChange={(e) => setSubstance(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Severity *
                </label>
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as AllergySeverity)}
                  className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="severe">Severe (Blocks Orders)</option>
                  <option value="life_threatening">Life-Threatening (Blocks Orders)</option>
                  <option value="moderate">Moderate (Caution Warning)</option>
                  <option value="mild">Mild (Informational)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reaction Symptom
                </label>
                <input
                  type="text"
                  placeholder="e.g. Anaphylaxis, Hives, Swelling"
                  value={reaction}
                  onChange={(e) => setReaction(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Clinical Notes / Context
              </label>
              <input
                type="text"
                placeholder="e.g. Diagnosed in ER 2021; patient reported throat tightness"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-white rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingAllergy(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 cursor-pointer transition-all"
              >
                Save Allergy Record
              </button>
            </div>
          </form>
        )}

        {/* Allergy List Table */}
        {allergies.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400 bg-slate-50 rounded-lg">
            No known allergies documented for this recipient.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
            {allergies.map((a) => {
              const isSevere = a.severity === "severe" || a.severity === "life_threatening";
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-800">
                        {a.substance}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isSevere
                            ? "bg-red-100 text-red-700 border border-red-200"
                            : a.severity === "moderate"
                              ? "bg-amber-100 text-amber-700 border border-amber-200"
                              : "bg-blue-100 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {a.severity.replace("_", "-")}
                      </span>
                    </div>
                    {a.reaction && (
                      <div className="text-xs text-slate-600 font-medium">
                        Reaction: {a.reaction}
                      </div>
                    )}
                    {a.notes && (
                      <div className="text-xs text-slate-400">{a.notes}</div>
                    )}
                  </div>
                  <button
                    onClick={() => handleRemoveAllergy(a.id, a.substance)}
                    className="text-xs text-slate-400 hover:text-red-600 px-2 py-1 rounded cursor-pointer transition-colors"
                    title="Delete allergy record"
                  >
                    ✕ Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Candidate Medication Allergy Pre-Check Bar */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Pre-Check New Medication Against Allergy Records
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter new medication name to check (e.g. Amoxicillin, Bactrim)"
              value={candidateMed}
              onChange={(e) => setCandidateMed(e.target.value)}
              className="flex-1 text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            {candidateMed && (
              <button
                type="button"
                onClick={() => setCandidateMed("")}
                className="text-xs text-slate-400 hover:text-slate-600 px-2"
              >
                Clear
              </button>
            )}
          </div>

          {allergyCheck && (
            <div
              className={`mt-2 p-3 rounded-lg text-xs font-medium border ${
                allergyCheck.blocked
                  ? "bg-red-50 text-red-800 border-red-200"
                  : allergyCheck.matched
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
              }`}
            >
              {allergyCheck.message}
            </div>
          )}
        </div>
      </div>

      {/* ── Drug Interactions Section ─────────────────────────────────────── */}
      {interactionCalls && interactionCalls.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  {t.drugInteractions}
                </h2>
                <ContextualHelp topicKey="drug_interaction_warning" caregiverId="caregiver" />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Drug-to-drug interactions (independent of personal allergy contraindications)
              </p>
            </div>
          </div>
          <div className="space-y-4">
            {interactionCalls.map((tc) => {
              const interactions = tc.result.interactions ?? [];
              return (
                <div
                  key={tc.id ?? `interaction-${JSON.stringify(tc.input)}`}
                  className="rounded-lg border border-slate-200 p-4"
                >
                  {tc.result.summary && (
                    <p className="text-sm text-slate-600">{tc.result.summary}</p>
                  )}
                  {interactions.length > 0 && (
                    <div
                      className={`space-y-2 ${
                        tc.result.summary ? "mt-4 border-t border-slate-200 pt-4" : ""
                      }`}
                    >
                      {interactions.map((ix: any) => (
                        <div
                          key={`${ix.drug1}-${ix.drug2}`}
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