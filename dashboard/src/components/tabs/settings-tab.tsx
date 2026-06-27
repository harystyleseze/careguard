"use client";

import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import type { CaregiverProfile, RecipientProfile } from "../../lib/types";
import { Toast } from "../primitives/toast";
import type { AgentInfo } from "../types";

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
  loadingAgentInfo?: boolean;
}

export function SettingsTab({
  recipient,
  caregiver,
  agentInfo,
  agentPaused,
  onTogglePause,
  onUpdateProfile,
}: SettingsTabProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const startEditing = () => {
    setForm({
      recipientName: recipient.name,
      recipientAge: String(recipient.age ?? ""),
      medications: (recipient.medications ?? []).join(", "),
      doctor: recipient.doctor ?? "",
      insurance: recipient.insurance ?? "",
      caregiverName: caregiver.name,
      relationship: caregiver.relationship ?? "",
      location: caregiver.location ?? "",
      notifications: caregiver.notifications ?? "",
    });
    setEditing(true);
  };

  const cancelEditing = () => setEditing(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdateProfile({
      recipient: {
        name: form.recipientName.trim() || recipient.name,
        age: form.recipientAge ? Number(form.recipientAge) : recipient.age,
        medications: form.medications.split(",").map((m) => m.trim()).filter(Boolean),
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
      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onDismiss={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Care Recipient</h2>
          {!editing && (
            <button
              onClick={startEditing}
              className="px-3 py-1.5 text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-100 cursor-pointer transition-all"
            >
              Edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            {editing ? (
              <input
                className={editClass}
                value={form.recipientName}
                onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                aria-label="Recipient Name"
              />
            ) : (
              <div className={readClass}>{recipient.name}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Age</label>
            {editing ? (
              <input
                type="number"
                className={editClass}
                value={form.recipientAge}
                onChange={(e) => setForm((f) => ({ ...f, recipientAge: e.target.value }))}
                aria-label="Recipient Age"
              />
            ) : (
              <div className={readClass}>{recipient.age ?? "N/A"}</div>
            )}
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Medications (comma-separated)
            </label>
            {editing ? (
              <input
                className={editClass + " w-full"}
                value={form.medications}
                onChange={(e) => setForm((f) => ({ ...f, medications: e.target.value }))}
                aria-label="Medications"
              />
            ) : (
              <div className={readClass}>{(recipient.medications ?? []).join(", ")}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Primary Doctor</label>
            {editing ? (
              <input
                className={editClass}
                value={form.doctor}
                onChange={(e) => setForm((f) => ({ ...f, doctor: e.target.value }))}
                aria-label="Primary Doctor"
              />
            ) : (
              <div className={readClass}>{recipient.doctor ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Insurance</label>
            {editing ? (
              <input
                className={editClass}
                value={form.insurance}
                onChange={(e) => setForm((f) => ({ ...f, insurance: e.target.value }))}
                aria-label="Insurance"
              />
            ) : (
              <div className={readClass}>{recipient.insurance ?? "N/A"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Caregiver</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
            {editing ? (
              <input
                className={editClass}
                value={form.caregiverName}
                onChange={(e) => setForm((f) => ({ ...f, caregiverName: e.target.value }))}
                aria-label="Caregiver Name"
              />
            ) : (
              <div className={readClass}>{caregiver.name}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Relationship</label>
            {editing ? (
              <input
                className={editClass}
                value={form.relationship}
                onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                aria-label="Relationship"
              />
            ) : (
              <div className={readClass}>{caregiver.relationship ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
            {editing ? (
              <input
                className={editClass}
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                aria-label="Location"
              />
            ) : (
              <div className={readClass}>{caregiver.location ?? "N/A"}</div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Notification Channel
            </label>
            {editing ? (
              <input
                className={editClass}
                value={form.notifications}
                onChange={(e) => setForm((f) => ({ ...f, notifications: e.target.value }))}
                aria-label="Notification Channel"
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
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Configuration</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agent Status</label>
            <div className="flex items-center gap-2">
              <div
                className={`px-3 py-2 flex-1 bg-slate-50 border border-slate-200 rounded-lg text-sm ${agentPaused ? "text-amber-600" : "text-green-600"}`}
              >
                {agentPaused ? "Paused" : "Active"}
              </div>
              <button
                onClick={onTogglePause}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all ${agentPaused ? "bg-green-500 text-white hover:bg-green-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}
              >
                {agentPaused ? "Resume Agent" : "Pause Agent"}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">LLM Provider</label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono">
              {agentInfo?.llm || "Not connected"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Network</label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {agentInfo?.network || "stellar:testnet"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agent Wallet</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono break-all">
                {agentInfo?.agentWallet || "Not connected"}
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
    </div>
  );
}
