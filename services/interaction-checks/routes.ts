import { Router } from "express";
import type { InteractionCheckStore } from "./db.ts";

function recipientIdOf(query: Record<string, unknown>): string {
  return typeof query.recipient_id === "string" && query.recipient_id
    ? query.recipient_id
    : "rosa";
}

/**
 * Drug interaction check history (#1193), mounted under /agent so it shares
 * the agent API key guard with the tools that produce it.
 *
 * GET /agent/interaction-checks?recipient_id=rosa&drug=warfarin&limit=50
 */
export function createInteractionChecksRouter(store: InteractionCheckStore): Router {
  const router = Router();

  router.get("/interaction-checks", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    const drug = typeof req.query.drug === "string" ? req.query.drug.slice(0, 100) : undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    res.json({ recipientId, checks: store.list(recipientId, { drug, limit }) });
  });

  return router;
}
