import { Router } from "express";
import { z } from "zod";
import type { CareRecipientsStore } from "./db.ts";
import { MAX_NETWORK_ENTRIES } from "../../shared/insurance-network.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";

/**
 * Caregiver-maintained insurance network lists (#1234).
 *
 * There is no payer integration, so the caregiver keeps the recipient's
 * in-network pharmacies and providers here by hand. compare_pharmacy_prices
 * and audit_medical_bill check against these lists.
 *
 * Mounted under /agent (behind requireApiKey), keyed by the same recipient_id
 * query parameter as the rest of the agent API.
 */

const EntrySchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(1, "name is required").max(200),
});

const NetworkBodySchema = z.object({
  plan: z.string().trim().max(200).nullable().optional(),
  pharmacies: z.array(EntrySchema).max(MAX_NETWORK_ENTRIES).default([]),
  providers: z.array(EntrySchema).max(MAX_NETWORK_ENTRIES).default([]),
  updated_by: z.string().max(100).optional(),
});

function recipientIdOf(query: unknown): string {
  const value = (query as Record<string, unknown>)?.recipient_id;
  return typeof value === "string" && value.trim() ? value.trim() : "rosa";
}

export function createInsuranceNetworkRouter(store: CareRecipientsStore): Router {
  const router = Router();

  router.get("/insurance-network", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    res.json({ recipientId, network: store.getInsuranceNetwork(recipientId) });
  });

  // Replaces both lists; the dashboard always sends the whole edited list.
  router.put("/insurance-network", (req, res) => {
    const parsed = NetworkBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid insurance network", issues: parsed.error.issues });
    }
    const recipientId = recipientIdOf(req.query);
    const { plan, pharmacies, providers, updated_by } = parsed.data;
    const network = store.setInsuranceNetwork(
      recipientId,
      { plan: plan?.trim() ? plan.trim() : null, pharmacies, providers },
      sanitizeUserString(updated_by) || "caregiver",
    );
    return res.json({ recipientId, network });
  });

  return router;
}
