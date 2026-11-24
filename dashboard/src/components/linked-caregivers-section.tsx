"use client";

import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { caregiverFetch } from "../lib/caregiver-fetch";
import {
  CAREGIVER_ROLES,
  LinkedCaregiverSchema,
  type CaregiverRole,
  type LinkedCaregiver,
} from "../lib/types";
import { getTranslations, type Locale } from "../i18n";

const InviteResponseSchema = z.object({
  caregiver: LinkedCaregiverSchema,
  inviteToken: z.string().min(1),
});

export interface LinkedCaregiversSectionProps {
  recipientId: string;
  locale?: Locale;
}

/**
 * Linked caregivers for a recipient (#1179): everyone sharing care, their
 * role, and an invite-by-email form. The server enforces roles; a 403 here
 * means the caller is not an owner.
 */
export function LinkedCaregiversSection({ recipientId, locale = "en" }: LinkedCaregiversSectionProps) {
  const t = getTranslations(locale).caregivers;
  const roleLabels: Record<CaregiverRole, string> = {
    owner: t.roleOwner,
    "co-caregiver": t.roleCoCaregiver,
    viewer: t.roleViewer,
  };
  const [caregivers, setCaregivers] = useState<LinkedCaregiver[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CaregiverRole>("co-caregiver");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issuedInvite, setIssuedInvite] = useState<{ email: string; token: string } | null>(null);

  const basePath = `/recipients/${encodeURIComponent(recipientId)}/caregivers`;

  useEffect(() => {
    let cancelled = false;
    caregiverFetch(basePath)
      .then(async (res) => {
        const parsed = LinkedCaregiverSchema.array().safeParse(res.ok ? (await res.json())?.caregivers : null);
        if (cancelled) return;
        if (parsed.success) {
          setCaregivers(parsed.data);
          setLoadError(null);
        } else {
          setLoadError(t.loadFailed);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(t.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, t.loadFailed]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    if (!z.email().safeParse(email.trim()).success) {
      setError(t.invalidEmail);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await caregiverFetch(`${basePath}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? t.inviteForbidden : res.status === 409 ? t.alreadyLinked : t.inviteFailed);
        return;
      }
      const parsed = InviteResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        setError(t.inviteFailed);
        return;
      }
      const { caregiver, inviteToken } = parsed.data;
      // Re-inviting a pending address replaces its entry.
      setCaregivers((prev) => [
        ...prev.filter((c) => c.caregiver_user_id !== caregiver.caregiver_user_id),
        caregiver,
      ]);
      setIssuedInvite({ email: caregiver.email ?? email.trim(), token: inviteToken });
      setEmail("");
    } catch {
      setError(t.inviteFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="linked-caregivers-title" className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 id="linked-caregivers-title" className="text-sm font-semibold text-slate-700 mb-1">
        {t.title}
      </h2>
      <p className="text-xs text-slate-500 mb-4">{t.description}</p>

      {loadError ? (
        <p role="alert" className="text-xs text-red-600 mb-4">
          {loadError}
        </p>
      ) : caregivers.length === 0 ? (
        <p className="text-xs text-slate-500 mb-4">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 mb-4">
          {caregivers.map((c) => (
            <li key={c.caregiver_user_id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-700 truncate">
                  {c.display_name ?? c.email ?? c.caregiver_user_id}
                </div>
                {c.display_name && c.email && <div className="text-xs text-slate-400 truncate">{c.email}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.status === "invited" && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    {t.pending}
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {roleLabels[c.role]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form noValidate onSubmit={handleInvite} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <h3 className="text-xs font-semibold text-slate-700">{t.inviteTitle}</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="invite-email" className="block text-xs font-medium text-slate-600 mb-1">
              {t.email}
            </label>
            <input
              id="invite-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="block text-xs font-medium text-slate-600 mb-1">
              {t.role}
            </label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as CaregiverRole)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {CAREGIVER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabels[r]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t.invite}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        {issuedInvite && (
          <div role="status" className="text-xs text-slate-600">
            <p>{t.inviteCode.replace("{email}", issuedInvite.email)}</p>
            <code className="block mt-1 p-2 bg-white border border-slate-200 rounded break-all select-all">
              {issuedInvite.token}
            </code>
          </div>
        )}
      </form>
    </section>
  );
}
