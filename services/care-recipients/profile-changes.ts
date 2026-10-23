import { Router } from "express";
import { z } from "zod";
import { appendAuditEntrySync } from "../../shared/audit-log.ts";
import { logger } from "../../shared/logger.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import {
  CaregiverAccessError,
  type AutoTopupRule,
  type CareRecipientsStore,
  type ProfileChangeDetail,
  type ProfileChangeKind,
  type ProfileChangeRequest,
} from "./db.ts";

/**
 * Owner approval for sensitive profile changes (#1233).
 *
 * With several caregivers on one recipient, some changes are too sensitive to
 * apply the moment anyone makes them. Mirroring the transaction approval
 * flow, these create a pending request in the Approvals tab instead, and only
 * a caregiver with the owner role can approve or reject it:
 *
 *   - policy_limit_increase: raising any spending limit or budget (or the
 *     approval threshold, which lets bigger payments skip approval)
 *   - caregiver_removal:     removing a linked caregiver
 *   - auto_topup_change:     any change to the wallet auto-topup rule
 *
 * Everything else — including *lowering* a limit — still applies immediately.
 * Requests and decisions are written to the audit log.
 *
 * Identity note (same model as approval delegation, #1195): the /agent API
 * authenticates with one shared AGENT_API_KEY, so the dashboard names the
 * acting caregiver with `caregiver_id`. When the recipient has linked
 * caregivers that id must resolve to an active owner link; a recipient with no
 * linked caregivers is a single-operator deployment whose API key holder is
 * the owner. The /recipients/:id/profile-changes routes use the
 * per-caregiver access tokens instead, and require the owner-only `manage`
 * permission.
 */

// ── Which policy changes are sensitive ───────────────────────────────────────

/** Limits whose increase loosens the policy and so needs owner approval. */
export const SENSITIVE_POLICY_LIMITS = {
  dailyLimit: "Daily limit",
  monthlyLimit: "Monthly limit",
  medicationMonthlyBudget: "Medication monthly budget",
  billMonthlyBudget: "Bill monthly budget",
  approvalThreshold: "Approval threshold",
} as const;

export type SensitivePolicyField = keyof typeof SENSITIVE_POLICY_LIMITS;
const SENSITIVE_FIELDS = Object.keys(SENSITIVE_POLICY_LIMITS) as SensitivePolicyField[];

type PolicyLike = Record<string, unknown>;

/** The limit fields `proposed` raises above `current`. */
export function policyLimitIncreases(current: PolicyLike, proposed: PolicyLike): ProfileChangeDetail[] {
  return SENSITIVE_FIELDS.flatMap((field) => {
    const before = Number(current[field]);
    const after = Number(proposed[field]);
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) return [];
    return [{ field, label: SENSITIVE_POLICY_LIMITS[field], before, after }];
  });
}

/**
 * Splits a policy update into the part that applies now and the limit
 * increases that wait for approval: `immediate` is `proposed` with every
 * increased limit held at its current value.
 */
export function splitPolicyUpdate<P extends PolicyLike>(
  current: P,
  proposed: P,
): { immediate: P; increases: ProfileChangeDetail[] } {
  const increases = policyLimitIncreases(current, proposed);
  const immediate = { ...proposed };
  for (const change of increases) {
    (immediate as PolicyLike)[change.field] = current[change.field];
  }
  return { immediate, increases };
}

function usd(value: unknown): string {
  return `$${Number(value).toFixed(2)}`;
}

function summarizeIncreases(increases: ProfileChangeDetail[]): string {
  return `Raise ${increases.map((c) => `${c.label.toLowerCase()} from ${usd(c.before)} to ${usd(c.after)}`).join(", ")}`;
}

// ── Appliers: how an approved request takes effect ──────────────────────────

export interface PolicyAccess {
  get(recipientId: string): PolicyLike;
  /** Returns an error message instead of saving when the merged policy is invalid. */
  set(recipientId: string, policy: PolicyLike): string | null;
}

export interface ProfileChangeAppliers {
  policy?: PolicyAccess;
}

function apply(
  store: CareRecipientsStore,
  appliers: ProfileChangeAppliers,
  request: ProfileChangeRequest,
  actor: string,
): string | null {
  switch (request.kind) {
    case "policy_limit_increase": {
      if (!appliers.policy) return "Policy changes can't be applied by this server";
      const fields = (request.payload.fields ?? {}) as PolicyLike;
      const merged = { ...appliers.policy.get(request.recipient_id), ...fields };
      return appliers.policy.set(request.recipient_id, merged);
    }
    case "caregiver_removal": {
      const caregiverUserId = String(request.payload.caregiverUserId ?? "");
      try {
        return store.removeCaregiver(request.recipient_id, caregiverUserId) ? null : "Caregiver is no longer linked";
      } catch (err) {
        if (err instanceof CaregiverAccessError) return err.message;
        throw err;
      }
    }
    case "auto_topup_change": {
      store.setAutoTopupRule(request.recipient_id, request.payload.rule as AutoTopupRule, actor);
      return null;
    }
  }
}

// ── Requests and decisions ───────────────────────────────────────────────────

export function requestProfileChange(
  store: CareRecipientsStore,
  input: {
    recipientId: string;
    kind: ProfileChangeKind;
    summary: string;
    changes: ProfileChangeDetail[];
    payload: Record<string, unknown>;
    requestedBy: string;
  },
): ProfileChangeRequest {
  const request = store.createProfileChangeRequest(input);
  try {
    appendAuditEntrySync({
      event: "profile_change.requested",
      actor: input.requestedBy,
      details: { requestId: request.id, recipientId: input.recipientId, kind: input.kind, changes: input.changes },
    });
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, "[profile-changes] failed appending request to audit log");
  }
  return request;
}

export type DecisionResult =
  | { ok: true; request: ProfileChangeRequest }
  | { ok: false; status: number; error: string };

/**
 * Approves (applying the change) or rejects a pending request. The caller has
 * already confirmed the actor is an owner. An approval whose change can no
 * longer be applied (e.g. the policy changed since) stays pending with a 409,
 * so the owner can reject it instead.
 */
export function decideProfileChange(
  store: CareRecipientsStore,
  appliers: ProfileChangeAppliers,
  params: { id: string; recipientId?: string; decision: "approved" | "rejected"; actor: string; note?: string },
): DecisionResult {
  const existing = store.getProfileChangeRequest(params.id);
  if (!existing || (params.recipientId && existing.recipient_id !== params.recipientId)) {
    return { ok: false, status: 404, error: "Profile change request not found" };
  }
  if (existing.status !== "pending") {
    return { ok: false, status: 409, error: `Profile change request was already ${existing.status}` };
  }
  if (params.decision === "approved") {
    const error = apply(store, appliers, existing, params.actor);
    if (error) return { ok: false, status: 409, error };
  }
  const decided = store.decideProfileChangeRequest(params.id, params.decision, params.actor, params.note);
  if (!decided) return { ok: false, status: 409, error: "Profile change request was already decided" };
  try {
    appendAuditEntrySync({
      event: params.decision === "approved" ? "profile_change.approved" : "profile_change.rejected",
      actor: params.actor,
      details: {
        requestId: decided.id,
        recipientId: decided.recipient_id,
        kind: decided.kind,
        changes: decided.changes,
        requestedBy: decided.requested_by,
        ...(params.note ? { note: params.note } : {}),
      },
    });
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, "[profile-changes] failed appending decision to audit log");
  }
  return { ok: true, request: decided };
}

/**
 * Applies the non-sensitive part of a policy update now and files any limit
 * increases for owner approval. Without increases this is a plain save.
 */
export function submitPolicyUpdate(
  store: CareRecipientsStore,
  policy: PolicyAccess,
  params: { recipientId: string; proposed: PolicyLike; requestedBy: string },
):
  | { ok: true; applied: PolicyLike; pendingApproval: ProfileChangeRequest | null }
  | { ok: false; error: string } {
  const current = policy.get(params.recipientId);
  const { immediate, increases } = splitPolicyUpdate(current, params.proposed);
  if (increases.length === 0) {
    const error = policy.set(params.recipientId, params.proposed);
    return error ? { ok: false, error } : { ok: true, applied: params.proposed, pendingApproval: null };
  }

  // Holding the increased limits back can make the rest of the update invalid
  // (e.g. a lower monthly limit than the current daily limit); then the whole
  // update waits for approval rather than half of it failing.
  const onlyIncreases = Object.keys(immediate).every(
    (field) => JSON.stringify(immediate[field]) === JSON.stringify(current[field]),
  );
  const deferAll = !onlyIncreases && policy.set(params.recipientId, immediate) !== null;
  const applied = deferAll ? current : immediate;
  const fields = Object.fromEntries(
    (deferAll ? Object.keys(params.proposed) : increases.map((c) => c.field))
      .filter((field) => params.proposed[field] !== undefined)
      .map((field) => [field, params.proposed[field]]),
  );
  const pendingApproval = requestProfileChange(store, {
    recipientId: params.recipientId,
    kind: "policy_limit_increase",
    summary: summarizeIncreases(increases),
    changes: increases,
    payload: { fields },
    requestedBy: params.requestedBy,
  });
  return { ok: true, applied, pendingApproval };
}

// ── Owner check for the shared-key /agent API ────────────────────────────────

export type OwnerCheck = { ok: true; actor: string } | { ok: false; status: number; error: string };

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function authorizeOwner(store: CareRecipientsStore, recipientId: string, caregiverId: unknown): OwnerCheck {
  const id = typeof caregiverId === "string" ? caregiverId.trim() : "";
  const links = store.listCaregivers(recipientId).filter((link) => link.status === "active");
  if (links.length === 0) return { ok: true, actor: id || "owner" };
  if (!id) return { ok: false, status: 400, error: "caregiver_id is required to approve profile changes" };
  const link = links.find(
    (l) =>
      l.caregiver_user_id === id ||
      (l.email && l.email.toLowerCase() === id.toLowerCase()) ||
      (l.display_name && slug(l.display_name) === slug(id)),
  );
  if (!link || link.role !== "owner") {
    return { ok: false, status: 403, error: "Only a caregiver with the owner role can approve or reject profile changes" };
  }
  return { ok: true, actor: id };
}

// ── /agent routes ────────────────────────────────────────────────────────────

const AutoTopupRuleSchema = z.object({
  enabled: z.boolean(),
  threshold: z.number().min(0).max(100_000),
  topUpAmount: z.number().positive().max(100_000),
  fundingSource: z.string().trim().min(1).max(64),
});

const DecisionBodySchema = z.object({
  caregiver_id: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

function recipientIdOf(query: unknown): string {
  const value = (query as Record<string, unknown>)?.recipient_id;
  return typeof value === "string" && value.trim() ? value.trim() : "rosa";
}

function sameRule(a: AutoTopupRule | null, b: AutoTopupRule): boolean {
  return (
    !!a &&
    a.enabled === b.enabled &&
    a.threshold === b.threshold &&
    a.topUpAmount === b.topUpAmount &&
    a.fundingSource === b.fundingSource
  );
}

/** Mounted under /agent (behind requireApiKey). */
export function createProfileChangesRouter(store: CareRecipientsStore, appliers: ProfileChangeAppliers): Router {
  const router = Router();

  router.get("/profile-changes", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    const status = req.query.status;
    const filter = status === "pending" || status === "approved" || status === "rejected" ? status : undefined;
    res.json({ recipientId, requests: store.listProfileChangeRequests(recipientId, filter) });
  });

  for (const [path, decision] of [["approve", "approved"], ["reject", "rejected"]] as const) {
    router.post(`/profile-changes/:id/${path}`, (req, res) => {
      const body = DecisionBodySchema.safeParse(req.body ?? {});
      if (!body.success) return res.status(400).json({ error: "Invalid request", issues: body.error.issues });
      const existing = store.getProfileChangeRequest(req.params.id);
      if (!existing) return res.status(404).json({ error: "Profile change request not found" });
      const owner = authorizeOwner(store, existing.recipient_id, body.data.caregiver_id);
      if (!owner.ok) return res.status(owner.status).json({ error: owner.error });
      const result = decideProfileChange(store, appliers, {
        id: existing.id,
        decision,
        actor: owner.actor,
        note: sanitizeUserString(body.data.note) || undefined,
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ success: true, request: result.request });
    });
  }

  router.get("/wallet/auto-topup", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    const pending = store
      .listProfileChangeRequests(recipientId, "pending")
      .filter((r) => r.kind === "auto_topup_change");
    res.json({ recipientId, rule: store.getAutoTopupRule(recipientId), pendingApproval: pending.at(-1) ?? null });
  });

  // Auto-topup moves money on its own, so every change waits for an owner.
  router.put("/wallet/auto-topup", (req, res) => {
    const parsed = AutoTopupRuleSchema.safeParse(req.body?.rule ?? req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid auto-topup rule", issues: parsed.error.issues });
    const recipientId = recipientIdOf(req.query);
    const current = store.getAutoTopupRule(recipientId);
    const rule = parsed.data;
    if (sameRule(current, rule)) return res.json({ recipientId, rule: current, pendingApproval: null });
    const fields: Array<[keyof AutoTopupRule, string]> = [
      ["enabled", "Auto-topup enabled"],
      ["threshold", "Top up when balance falls below"],
      ["topUpAmount", "Top-up amount"],
      ["fundingSource", "Funding source"],
    ];
    const changes = fields
      .filter(([key]) => current?.[key] !== rule[key])
      .map(([key, label]) => ({ field: key, label, before: current?.[key] ?? null, after: rule[key] }));
    const pendingApproval = requestProfileChange(store, {
      recipientId,
      kind: "auto_topup_change",
      summary: rule.enabled
        ? `Set wallet auto-topup to add ${usd(rule.topUpAmount)} ${rule.fundingSource} when the balance falls below ${usd(rule.threshold)}`
        : "Turn off wallet auto-topup",
      changes,
      payload: { rule },
      requestedBy: sanitizeUserString(req.body?.caregiver_id) || "caregiver",
    });
    return res.status(202).json({ recipientId, rule: current, pendingApproval });
  });

  return router;
}
