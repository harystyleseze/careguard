"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { copyText } from "../../lib/clipboard";
import type { CaregiverProfile, RecipientProfile } from "../../lib/types";
import { RecipientWizard } from "../recipient-wizard";
import { Toast } from "../primitives/toast";
import { ConfirmDialog } from "../primitives/confirm-dialog";
import type { AgentInfo } from "../types";
import { NETWORK_LABEL } from "../../lib/stellar-network";
import { getTranslations, type Locale } from "../../i18n";
import { AGENT_URL } from "../../lib/agent-url";
import { agentFetch } from "../../lib/agent-fetch";
import { LinkedCaregiversSection } from "../linked-caregivers-section";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationChannel,
  type NotificationEventType,
} from "../../../../shared/notifications";
import { ConsentSettingsSection } from "../consent-settings-section";

export interface RecipientOption {
  id: string;
  name: string;
}

export interface SettingsTabProps {
  recipient: RecipientProfile;
  caregiver: CaregiverProfile;
  agentInfo: AgentInfo | null;
  agentPaused: boolean;
  onTogglePause: () => void;
  onUpdateProfile: (patch: {
    recipient?: Partial<RecipientProfile>;
    caregiver?: Partial<CaregiverProfile>;
  }) => Promise<void>;
  recipients?: RecipientOption[];
  selectedRecipientId?: string;
  onSelectRecipient?: (id: string) => void;
  locale?: Locale;
}

export function SettingsTab({
  recipient,
  caregiver,
  agentInfo,
  agentPaused,
  onTogglePause,
  onUpdateProfile,
  recipients,
  selectedRecipientId,
  onSelectRecipient,
  locale = "en",
}: SettingsTabProps) {
  const t = getTranslations(locale);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Issue #1257: brief loading feedback while the parent refetches data for a
  // newly selected recipient. The switch completes when the parent applies the
  // selection (selectedRecipientId/recipient props update).
  const [switching, setSwitching] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [postSaveChangedFields, setPostSaveChangedFields] = useState<string[] | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState(DEFAULT_NOTIFICATION_PREFERENCES);

  // --- Recipient Allergies State & Handlers (Issue #1230) ---
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
  const [allergySubstance, setAllergySubstance] = useState("");
  const [allergySeverity, setAllergySeverity] = useState<AllergySeverity>("severe");
  const [allergyReaction, setAllergyReaction] = useState("");
  const [allergyNotes, setAllergyNotes] = useState("");

  const recipientId = selectedRecipientId || (recipient.name.toLowerCase().includes("rosa") ? "rosa" : "rosa");

  useEffect(() => {
    async function fetchAllergies() {
      try {
        setLoadingAllergies(true);
        const res = await agentFetch(`${AGENT_URL}/agent/allergies?recipient_id=${recipientId}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.allergies) && data.allergies.length > 0) {
            setAllergies(data.allergies);
          }
        }
      } catch {
        // Fall back to local default
      } finally {
        setLoadingAllergies(false);
      }
    }
    fetchAllergies();
  }, [recipientId]);

  const handleAddAllergy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allergySubstance.trim()) {
      setToastMsg("Please specify the allergen substance");
      return;
    }
    const newEntry: RecipientAllergy = {
      id: `allergy-${Date.now()}`,
      substance: allergySubstance.trim(),
      severity: allergySeverity,
      reaction: allergyReaction.trim() || undefined,
      notes: allergyNotes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    setAllergies((prev) => [...prev, newEntry]);
    setIsAddingAllergy(false);
    setAllergySubstance("");
    setAllergyReaction("");
    setAllergyNotes("");

    try {
      await agentFetch(`${AGENT_URL}/agent/allergies`, {
        method: "POST",
        body: JSON.stringify(newEntry),
      });
      setToastMsg(`Added allergy record for ${newEntry.substance}`);
    } catch {
      setToastMsg(`Saved allergy record locally for ${newEntry.substance}`);
    }
  };

  const handleRemoveAllergy = async (id: string, name: string) => {
    setAllergies((prev) => prev.filter((a) => a.id !== id));
    try {
      await agentFetch(`${AGENT_URL}/agent/allergies/${id}`, { method: "DELETE" });
    } catch {
      // Local removal succeeded
    }
    setToastMsg(`Removed allergy: ${name}`);
  };

  const handleDownloadData = async () => {
    try {
      setExporting(true);
      const res = await agentFetch(`${AGENT_URL}/recipients/${recipientId}/export`);
      if (!res.ok) {
        if (res.status === 429) {
          setToastMsg("Export rate limit reached. Please wait a few minutes before trying again.");
          return;
        }
        setToastMsg("Failed to download recipient data export.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `careguard-export-${recipientId}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setToastMsg(`Downloaded full data export for ${recipient.name}`);
    } catch {
      setToastMsg("Network error during data takeout.");
    } finally {
      setExporting(false);
    }
  };

  const [form, setForm] = useState({
    recipientName: "",
    recipientAge: "",
    medications: "",
    doctor: "",
    insurance: "",
    caregiverName: "",
    relationship: "",
    location: "",
    notifications: "",
  });

  const initialForm = {
    recipientName: recipient.name,
    recipientAge: String(recipient.age ?? ""),
    medications: (recipient.medications ?? []).join(", "),
    doctor: recipient.doctor ?? "",
    insurance: recipient.insurance ?? "",
    caregiverName: caregiver.name,
    relationship: caregiver.relationship ?? "",
    location: caregiver.location ?? "",
    notifications: caregiver.notifications ?? "",
  };

  const hasUnsavedChanges = editing && JSON.stringify(form) !== JSON.stringify(initialForm);

  const changedFields = (Object.keys(initialForm) as Array<keyof typeof form>).filter(
    (key) => form[key] !== initialForm[key]
  );

  const startEditing = () => {
    setForm(initialForm);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setShowUnsavedDialog(false);
    setPendingNavigation(false);
  };

  const handleDiscardChanges = () => {
    setEditing(false);
    setShowUnsavedDialog(false);
  };

  const handleKeepEditing = () => {
    setShowUnsavedDialog(false);
    setPendingNavigation(false);
  };

  const handleSelectRecipient = (id: string) => {
    if (!onSelectRecipient || switching || id === (selectedRecipientId ?? "")) return;
    setSwitching(true);
    onSelectRecipient(id);
  };

  const updateNotificationPreference = (
    eventType: NotificationEventType,
    channel: NotificationChannel,
    value: boolean,
  ) => {
    setNotificationPrefs((prev) => ({
      ...prev,
      [eventType]: {
        ...prev[eventType],
        [channel]: value,
      },
    }));
  };

  const EVENT_LABELS: Record<NotificationEventType, string> = {
    "approval-needed": "Approval needed",
    "policy-blocked": "Policy blocked",
    "wallet-low": "Wallet low",
    "price-drop": "Price drop",
    "bill-audit": "Bill audit",
    "critical-safety": "Critical safety alerts",
    system: "System updates",
  };

  useEffect(() => {
    setSwitching(false);
  }, [selectedRecipientId, recipient]);

  const router = useRouter();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab") || "overview";

  // Issue #1276: Warn before leaving Settings tab if unsaved edits exist
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (currentTab !== "settings" && hasUnsavedChanges && !pendingNavigation) {
      setShowUnsavedDialog(true);
      setPendingNavigation(true);
    }
  }, [currentTab, hasUnsavedChanges, pendingNavigation]);

  const handleSave = async () => {
    setSaving(true);
    // Capture which fields changed before saving
    const changedBeforeSave = (Object.keys(initialForm) as Array<keyof typeof form>).filter(
      (key) => form[key] !== initialForm[key]
    );
    // Trim, de-duplicate, and filter empty medication entries
    const medicationList = [...new Set(
      form.medications
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    )];
    await onUpdateProfile({
      recipient: {
        name: form.recipientName.trim() || recipient.name,
        age: form.recipientAge ? Number(form.recipientAge) : recipient.age,
        medications: medicationList,
        doctor: form.doctor.trim() || recipient.doctor,
        insurance: form.insurance.trim() || recipient.insurance,
      },
      caregiver: {
        name: form.caregiverName.trim() || caregiver.name,
        relationship: form.relationship.trim() || caregiver.relationship,
        location: form.location.trim() || caregiver.location,
        notifications: form.notifications.trim() || caregiver.notifications,
      },
    });
    setSaving(false);
    setEditing(false);
    setPostSaveChangedFields(changedBeforeSave);
  };

  const handleCopy = async (text: string, id: string) => {
    const result = await copyText(text);
    if (result === "ok" || result === "fallback") {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      return;
    }
    setToastMsg("Couldn't copy. Press Ctrl+C.");
    setToastFallback(text);
  };

  const readClass = "px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm";
  const editClass = "px-3 py-2 bg-white border border-sky-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <div
      role="tabpanel"
      id="tabpanel-settings"
      aria-labelledby="tab-settings"
      tabIndex={0}
      className="space-y-6 max-w-2xl"
    >
      <ConfirmDialog
        open={showUnsavedDialog}
        title="Discard unsaved edits?"
        description="You have unsaved changes to recipient and caregiver details. Do you want to discard them and leave this tab?"
        confirmLabel="Discard edits"
        cancelLabel="Keep editing"
        destructive
        onConfirm={handleDiscardChanges}
        onCancel={handleKeepEditing}
      />
      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onDismiss={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
      {showWizard && <RecipientWizard onClose={() => setShowWizard(false)} />}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-700">{t.settings.recipient}</h2>
            {recipients && recipients.length > 1 && onSelectRecipient && (
              <div className="flex items-center gap-1.5" aria-busy={switching}>
                <select
                  className={`text-xs border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-sky-500 ${switching ? "opacity-60" : ""}`}
                  value={selectedRecipientId ?? ''}
                  onChange={(e) => handleSelectRecipient(e.target.value)}
                  disabled={switching}
                  aria-label={t.settings.recipient}
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                {switching && (
                  <span
                    aria-hidden="true"
                    data-testid="recipient-switch-spinner"
                    className="inline-block w-3 h-3 border-2 border-sky-600 border-t-transparent rounded-full animate-spin"
                  />
                )}
                <span role="status" className="sr-only">
                  {switching ? t.common.loading : recipient.name}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer transition-all"
            >
              New Wizard
            </button>
            {!editing && (
              <button
                onClick={startEditing}
                className="px-3 py-1.5 text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer transition-all"
              >
                Edit
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.name}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.recipientName}
                onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                aria-label={t.settings.name}
              />
            ) : (
              <div className={readClass}>{recipient.name}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.age}</label>
            {editing ? (
              <input
                type="number"
                className={editClass}
                value={form.recipientAge}
                onChange={(e) => setForm((f) => ({ ...f, recipientAge: e.target.value }))}
                aria-label={t.settings.age}
              />
            ) : (
              <div className={readClass}>{recipient.age ?? "N/A"}</div>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {`${t.settings.medications} (comma-separated)`}
            </label>
            {editing ? (
              <input
                className={editClass + " w-full"}
                value={form.medications}
                onChange={(e) => setForm((f) => ({ ...f, medications: e.target.value }))}
                placeholder="e.g., Lisinopril, Metformin, Atorvastatin"
                aria-label={t.settings.medications}
              />
            ) : (
              <div className={readClass}>{(recipient.medications ?? []).join(", ")}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.doctor}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.doctor}
                onChange={(e) => setForm((f) => ({ ...f, doctor: e.target.value }))}
                aria-label={t.settings.doctor}
              />
            ) : (
              <div className={readClass}>{recipient.doctor ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.insurance}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.insurance}
                onChange={(e) => setForm((f) => ({ ...f, insurance: e.target.value }))}
                aria-label={t.settings.insurance}
              />
            ) : (
              <div className={readClass}>{recipient.insurance ?? "N/A"}</div>
            )}
          </div>
        </div>
      </div>

      {/* Recipient Allergies & Adverse Reactions (Issue #1230) */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <span>⚠️ Recipient Allergies & Adverse Reactions</span>
              <span className="text-xs bg-red-100 text-red-700 font-medium px-2 py-0.5 rounded-full">
                {allergies.length} documented
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Independent allergy registry checked before any medication purchase to prevent adverse reactions.
            </p>
          </div>
          <button
            onClick={() => setIsAddingAllergy(!isAddingAllergy)}
            className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer transition-all"
          >
            {isAddingAllergy ? "Cancel" : "+ Add Allergy"}
          </button>
        </div>

        {isAddingAllergy && (
          <form onSubmit={handleAddAllergy} className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h3 className="text-xs font-semibold text-slate-700">Add New Allergy or Adverse Reaction</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Substance / Drug *</label>
                <input
                  type="text"
                  required
                  value={allergySubstance}
                  onChange={(e) => setAllergySubstance(e.target.value)}
                  placeholder="e.g. Penicillin, Sulfa, Aspirin"
                  className={editClass + " w-full"}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Severity *</label>
                <select
                  value={allergySeverity}
                  onChange={(e) => setAllergySeverity(e.target.value as AllergySeverity)}
                  className={editClass + " w-full"}
                >
                  <option value="mild">Mild (rash, mild itching)</option>
                  <option value="moderate">Moderate (hives, swelling)</option>
                  <option value="severe">Severe (bronchospasm, facial swelling)</option>
                  <option value="life_threatening">Life-Threatening (anaphylaxis, shock)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Specific Reaction</label>
                <input
                  type="text"
                  value={allergyReaction}
                  onChange={(e) => setAllergyReaction(e.target.value)}
                  placeholder="e.g. Anaphylactic shock, hives, breathing difficulty"
                  className={editClass + " w-full"}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Clinical Notes</label>
                <input
                  type="text"
                  value={allergyNotes}
                  onChange={(e) => setAllergyNotes(e.target.value)}
                  placeholder="e.g. Diagnosed in ER, avoid all beta-lactams"
                  className={editClass + " w-full"}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAddingAllergy(false)}
                className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 cursor-pointer"
              >
                Save Allergy
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                <th className="py-2 px-3 font-medium">Substance</th>
                <th className="py-2 px-3 font-medium">Severity</th>
                <th className="py-2 px-3 font-medium">Reaction</th>
                <th className="py-2 px-3 font-medium">Notes</th>
                <th className="py-2 px-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {allergies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    No allergies documented.
                  </td>
                </tr>
              ) : (
                allergies.map((allergy) => (
                  <tr key={allergy.id} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-medium text-slate-800">{allergy.substance}</td>
                    <td className="py-2 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          allergy.severity === "life_threatening"
                            ? "bg-red-600 text-white"
                            : allergy.severity === "severe"
                            ? "bg-red-100 text-red-800"
                            : allergy.severity === "moderate"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {allergy.severity.replace("_", "-").toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-600">{allergy.reaction || "—"}</td>
                    <td className="py-2 px-3 text-slate-500 max-w-xs truncate" title={allergy.notes}>
                      {allergy.notes || "—"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleRemoveAllergy(allergy.id, allergy.substance)}
                        className="text-red-500 hover:text-red-700 font-medium cursor-pointer"
                        title="Remove allergy record"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRecipientId && (
        <>
          <LinkedCaregiversSection recipientId={selectedRecipientId} locale={locale} />
          <ConsentSettingsSection recipientId={selectedRecipientId} />
        </>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Notification preference center</h2>
            <p className="text-xs text-slate-500 mt-1">Choose which alert types and channels caregivers receive.</p>
          </div>
        </div>
        <div className="space-y-3">
          {(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as NotificationEventType[]).map((eventType) => {
            const isCritical = eventType === "critical-safety";
            return (
              <div key={eventType} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{EVENT_LABELS[eventType]}</span>
                  {isCritical && (
                    <span className="text-[10px] uppercase tracking-wide font-semibold rounded-full bg-red-100 text-red-700 px-2 py-0.5">
                      Always on
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["email", "sms", "slack"] as NotificationChannel[]).map((channel) => (
                    <label key={`${eventType}-${channel}`} className="flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={isCritical || notificationPrefs[eventType][channel]}
                        disabled={isCritical}
                        aria-label={`${EVENT_LABELS[eventType]} ${channel}`}
                        onChange={(e) => updateNotificationPreference(eventType, channel, e.target.checked)}
                      />
                      <span className="capitalize">{channel}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t.settings.caregiver}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.name}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.caregiverName}
                onChange={(e) => setForm((f) => ({ ...f, caregiverName: e.target.value }))}
                aria-label={`${t.settings.caregiver} ${t.settings.name}`}
              />
            ) : (
              <div className={readClass}>{caregiver.name}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.relationship}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.relationship}
                onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                aria-label={t.settings.relationship}
              />
            ) : (
              <div className={readClass}>{caregiver.relationship ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.location}</label>
            {editing ? (
              <input
                className={editClass}
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                aria-label={t.settings.location}
              />
            ) : (
              <div className={readClass}>{caregiver.location ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t.settings.notifications}
            </label>
            {editing ? (
              <input
                className={editClass}
                value={form.notifications}
                onChange={(e) => setForm((f) => ({ ...f, notifications: e.target.value }))}
                aria-label={t.settings.notifications}
              />
            ) : (
              <div className={readClass}>{caregiver.notifications ?? "N/A"}</div>
            )}
          </div>
        </div>
        {editing && (
          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={cancelEditing}
              className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 transition-all"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
        {postSaveChangedFields && postSaveChangedFields.length > 0 && (
          <div className="mt-3 p-3 bg-slate-50 rounded-border text-xs text-slate-700">
            <p className="font-medium mb-1">Updated fields:</p>
            <ul className="space-y-1">
              {postSaveChangedFields.map((field) => (
                <li key={field} className="flex items-center">
                  <span className="text-slate-500 mr-2">{field}:</span>
                  <span className="font-mono">
                    {initialForm[field as keyof typeof form] || ""} → {form[field as keyof typeof form] || ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">{t.settings.agentConfig}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.settings.agentStatus}</label>
            <div className="flex items-center gap-2">
              <div
                className={`px-3 py-2 flex-1 bg-slate-50 border border-slate-200 rounded-lg text-sm ${agentPaused ? "text-amber-600" : "text-green-600"}`}
              >
                {agentPaused ? t.status.paused : t.status.active}
              </div>
              <button
                onClick={onTogglePause}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all ${agentPaused ? "bg-green-500 text-white hover:bg-green-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}
              >
                {agentPaused ? t.actions.resume : t.actions.pause}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.wallet.llmProvider}</label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono">
              {agentInfo?.llm || t.settings.notConnected}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.wallet.network}</label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              {NETWORK_LABEL}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t.wallet.agentWallet}</label>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                title={agentInfo?.agentWallet || ""}
              >
                {agentInfo?.agentWallet ? truncateAddress(agentInfo.agentWallet) : t.settings.notConnected}
              </code>
              {agentInfo?.agentWallet && (
                <button
                  onClick={() => handleCopy(agentInfo.agentWallet, "settings-wallet")}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${copiedId === "settings-wallet" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {copiedId === "settings-wallet" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Data Portability & GDPR Takeout (Issue #1225) ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Data Portability & Takeout</h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl">
              Download a complete, portable archive of {recipient.name}&apos;s healthcare records, medications with dosage change history, spending policy, transactions, orders, and clinical notes (GDPR-style data takeout).
            </p>
          </div>
          <button
            onClick={handleDownloadData}
            disabled={exporting}
            className="shrink-0 px-4 py-2 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs font-medium rounded-lg cursor-pointer transition-all flex items-center gap-1.5"
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
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
              />
            </svg>
            {exporting ? "Preparing Export…" : "Download my data"}
          </button>
        </div>
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-2">
          <span>Standardized JSON bundle • Internal system keys excluded</span>
          <span>Rate-limited & tamper-evident audit logged</span>
        </div>
      </div>
    </div>
  );
}
