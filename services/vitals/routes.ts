import { Router } from "express";
import { z } from "zod";
import { VITAL_TYPES, VITAL_UNITS, isVitalType, type VitalsStore } from "./db.ts";

const MAX_VALUE = 10_000;

const VitalBodySchema = z
  .object({
    type: z.enum(VITAL_TYPES),
    value: z.number().positive().max(MAX_VALUE),
    secondary_value: z.number().positive().max(MAX_VALUE).nullish(),
    unit: z.string().optional(),
    timestamp: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type === "blood_pressure" && body.secondary_value == null) {
      ctx.addIssue({
        code: "custom",
        path: ["secondary_value"],
        message: "Blood pressure needs a diastolic reading",
      });
    }
    if (body.unit !== undefined && !VITAL_UNITS[body.type].includes(body.unit)) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: `Unit must be one of: ${VITAL_UNITS[body.type].join(", ")}`,
      });
    }
  });

function recipientIdOf(query: Record<string, unknown>): string {
  return typeof query.recipient_id === "string" && query.recipient_id
    ? query.recipient_id
    : "rosa";
}

/**
 * Manual vitals logging routes (#1237), mounted under /agent so they share
 * the agent API key guard with the adherence endpoints they are charted with.
 */
export function createVitalsRouter(store: VitalsStore): Router {
  const router = Router();

  router.get("/vitals", (req, res) => {
    const recipientId = recipientIdOf(req.query);
    const type = req.query.type;
    if (type !== undefined && !isVitalType(type)) {
      res.status(400).json({ error: `type must be one of: ${VITAL_TYPES.join(", ")}` });
      return;
    }
    res.json({ recipientId, vitals: store.list(recipientId, type) });
  });

  router.post("/vitals", (req, res) => {
    const parsed = VitalBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid vital", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const created = store.create({
      recipient_id: recipientIdOf(req.query),
      type: body.type,
      value: body.value,
      secondary_value: body.type === "blood_pressure" ? body.secondary_value ?? null : null,
      unit: body.unit ?? VITAL_UNITS[body.type][0],
      timestamp: body.timestamp ?? new Date().toISOString(),
    });
    res.status(201).json(created);
  });

  router.delete("/vitals/:id", (req, res) => {
    const removed = store.delete(recipientIdOf(req.query), req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Vital not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
