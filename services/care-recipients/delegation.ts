import { Router } from "express";
import type { ApprovalDelegation, CareRecipientsStore } from "./db.ts";
import { delegationStatus } from "./db.ts";

/**
 * Temporary approval delegation (#1195).
 *
 * A primary caregiver (delegator) can let a co-caregiver (delegate) approve or
 * deny pending transactions for one recipient during a fixed window, e.g. while
 * travelling. Delegations expire on their own at `ends_at` and can be revoked
 * early by the delegator.
 *
 * Identity note: the agent API authenticates with one shared AGENT_API_KEY, so
 * caregivers are identified by the `caregiver_id` the dashboard sends (the same
 * model as co-caregiver presence, #1231). The delegation check stops a
 * caregiver acting for someone else outside an active window; it can't
 * authenticate *who* the caller is until per-caregiver credentials exist.
 */

/** Longest window a single delegation may cover. */
export const MAX_DELEGATION_DAYS = 30;

const ID_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

export type ApprovalActorResult =
  | { ok: true; actor: string; delegated: false }
  | { ok: true; actor: string; delegated: true; onBehalfOf: string; delegation: ApprovalDelegation }
  | { ok: false; status: number; error: string };

/**
 * Decide whether `caregiverId` may approve/deny for `recipientId`, acting for
 * `onBehalfOf` when given. Acting for someone else requires a delegation from
 * them that is active right now.
 */
export function authorizeApprovalActor(
  store: CareRecipientsStore,
  params: { recipientId: string; caregiverId?: unknown; onBehalfOf?: unknown; now?: Date },
): ApprovalActorResult {
  const caregiverId = typeof params.caregiverId === "string" ? params.caregiverId.trim() : "";
  const onBehalfOf = typeof params.onBehalfOf === "string" ? params.onBehalfOf.trim() : "";

  if (!onBehalfOf || onBehalfOf === caregiverId) {
    // Acting as yourself; "api" keeps the existing unattributed behaviour.
    return { ok: true, actor: caregiverId || "api", delegated: false };
  }
  if (!caregiverId) {
    return { ok: false, status: 400, error: "caregiver_id is required when acting on_behalf_of another caregiver" };
  }
  const delegation = store.findActiveDelegation(params.recipientId, onBehalfOf, caregiverId, params.now);
  if (!delegation) {
    return { ok: false, status: 403, error: `No active delegation from ${onBehalfOf} to ${caregiverId} for this recipient` };
  }
  return { ok: true, actor: caregiverId, delegated: true, onBehalfOf, delegation };
}

function withStatus(d: ApprovalDelegation, now = new Date()) {
  return { ...d, status: delegationStatus(d, now) };
}

/** Mounted under /agent (behind requireApiKey). */
export function createDelegationsRouter(store: CareRecipientsStore): Router {
  const router = Router();

  // Create: { recipient_id, delegator, delegate, starts_at?, ends_at }
  router.post("/delegations", (req, res) => {
    const { recipient_id, delegator, delegate, starts_at, ends_at } = req.body ?? {};
    for (const [name, value] of Object.entries({ recipient_id, delegator, delegate })) {
      if (typeof value !== "string" || !ID_PATTERN.test(value)) {
        return res.status(400).json({ error: `${name} is required (1-64 chars: letters, digits, _ . -)` });
      }
    }
    if (delegator === delegate) {
      return res.status(400).json({ error: "delegator and delegate must be different caregivers" });
    }
    const now = Date.now();
    const start = starts_at === undefined ? now : Date.parse(starts_at);
    const end = Date.parse(ends_at);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return res.status(400).json({ error: "starts_at and ends_at must be ISO-8601 timestamps" });
    }
    if (end <= start) return res.status(400).json({ error: "ends_at must be after starts_at" });
    if (end <= now) return res.status(400).json({ error: "ends_at must be in the future" });
    if (end - start > MAX_DELEGATION_DAYS * 86_400_000) {
      return res.status(400).json({ error: `a delegation may last at most ${MAX_DELEGATION_DAYS} days` });
    }
    const created = store.createDelegation({
      recipient_id,
      delegator,
      delegate,
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(end).toISOString(),
    });
    return res.status(201).json(withStatus(created));
  });

  // List for a recipient, optionally only the active ones held by a delegate.
  router.get("/delegations", (req, res) => {
    const recipientId = typeof req.query.recipient_id === "string" ? req.query.recipient_id : "";
    if (!recipientId) return res.status(400).json({ error: "recipient_id is required" });
    const delegate = typeof req.query.delegate === "string" ? req.query.delegate : "";
    const now = new Date();
    const rows = delegate ? store.listActiveDelegationsFor(recipientId, delegate, now) : store.listDelegations(recipientId);
    return res.json({ delegations: rows.map((d) => withStatus(d, now)) });
  });

  // Revoke early: { delegator } must match the delegation's delegator.
  router.post("/delegations/:id/revoke", (req, res) => {
    const delegator = typeof req.body?.delegator === "string" ? req.body.delegator : "";
    const existing = store.getDelegation(req.params.id);
    if (!existing) return res.status(404).json({ error: "Delegation not found" });
    if (!delegator || delegator !== existing.delegator) {
      return res.status(403).json({ error: "Only the delegating caregiver can revoke this delegation" });
    }
    const revoked = store.revokeDelegation(existing.id, delegator);
    if (!revoked) return res.status(409).json({ error: "Delegation already revoked or expired" });
    return res.json(withStatus(revoked));
  });

  return router;
}
