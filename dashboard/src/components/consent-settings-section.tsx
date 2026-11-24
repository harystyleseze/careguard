"use client";

import { useEffect, useState } from "react";
import { caregiverFetch } from "../lib/caregiver-fetch";
import {
  DEFAULT_CONSENT_SETTINGS,
  type ConsentSettings,
  type RoleConsent,
} from "../lib/types";
import { Toast } from "./primitives/toast";

export interface ConsentSettingsSectionProps {
  recipientId: string;
}

/**
 * Granular data-sharing consent settings per recipient (#1218).
 * Configures visibility of medications, bills, and wallet data per caregiver role.
 */
export function ConsentSettingsSection({ recipientId }: ConsentSettingsSectionProps) {
  const [consent, setConsent] = useState<ConsentSettings>(DEFAULT_CONSENT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    caregiverFetch(`/recipients/${encodeURIComponent(recipientId)}/consent`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (data?.consent) {
            setConsent(data.consent);
          }
        }
      })
      .catch(() => {
        // Fall back gracefully to default consent
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [recipientId]);

  const handleToggle = (role: "co-caregiver" | "viewer", category: keyof RoleConsent) => {
    setConsent((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [category]: !prev[role][category],
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setErrorMsg(null);
      const res = await caregiverFetch(`/recipients/${encodeURIComponent(recipientId)}/consent`, {
        method: "PUT",
        body: JSON.stringify(consent),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update consent settings");
      }

      const data = await res.json();
      if (data?.consent) {
        setConsent(data.consent);
      }
      setToastMsg("Data-sharing consent settings saved and logged to audit trail");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save consent settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">
            Granular Data-Sharing Consent
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Control which healthcare and financial categories non-owner caregivers can view for this recipient.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
        >
          {saving ? "Saving..." : "Save Consent"}
        </button>
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="py-6 text-center text-xs text-slate-400">Loading consent settings...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500">
                <th className="py-2.5 font-medium">Caregiver Role</th>
                <th className="py-2.5 font-medium text-center">Medications</th>
                <th className="py-2.5 font-medium text-center">Medical Bills</th>
                <th className="py-2.5 font-medium text-center">Wallet & USDC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Owner Role (Always full access) */}
              <tr className="bg-slate-50/50">
                <td className="py-3 font-medium text-slate-700">
                  Owner / Primary
                  <span className="ml-2 text-[10px] text-slate-400 font-normal">
                    (Full Access)
                  </span>
                </td>
                <td className="py-3 text-center">
                  <span className="inline-block px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-medium">
                    Always Visible
                  </span>
                </td>
                <td className="py-3 text-center">
                  <span className="inline-block px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-medium">
                    Always Visible
                  </span>
                </td>
                <td className="py-3 text-center">
                  <span className="inline-block px-2 py-0.5 bg-slate-200 text-slate-700 rounded text-[10px] font-medium">
                    Always Visible
                  </span>
                </td>
              </tr>

              {/* Co-Caregiver Role */}
              <tr>
                <td className="py-3 font-medium text-slate-700">
                  Co-Caregiver
                  <span className="block text-[10px] text-slate-400 font-normal">
                    Family members sharing care
                  </span>
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Co-Caregiver Medications Access"
                    checked={consent["co-caregiver"].medications}
                    onChange={() => handleToggle("co-caregiver", "medications")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Co-Caregiver Medical Bills Access"
                    checked={consent["co-caregiver"].bills}
                    onChange={() => handleToggle("co-caregiver", "bills")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Co-Caregiver Wallet Access"
                    checked={consent["co-caregiver"].wallet}
                    onChange={() => handleToggle("co-caregiver", "wallet")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
              </tr>

              {/* Viewer Role */}
              <tr>
                <td className="py-3 font-medium text-slate-700">
                  Viewer
                  <span className="block text-[10px] text-slate-400 font-normal">
                    Aides, observers, secondary contacts
                  </span>
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Viewer Medications Access"
                    checked={consent.viewer.medications}
                    onChange={() => handleToggle("viewer", "medications")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Viewer Medical Bills Access"
                    checked={consent.viewer.bills}
                    onChange={() => handleToggle("viewer", "bills")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
                <td className="py-3 text-center">
                  <input
                    type="checkbox"
                    aria-label="Viewer Wallet Access"
                    checked={consent.viewer.wallet}
                    onChange={() => handleToggle("viewer", "wallet")}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {toastMsg && (
        <Toast
          message={toastMsg}
          onClose={() => setToastMsg(null)}
          type="success"
        />
      )}
    </div>
  );
}
