import { Router } from "express";
import { z } from "zod";
import { CarePlanStore } from "./db.ts";

const recipient = z.string().min(1).max(128);
const schedule = z.object({ recipientId: recipient, medication: z.string().trim().min(1).max(120), dosage: z.string().trim().min(1).max(120), frequency: z.string().trim().min(1).max(80), startDate: z.string().datetime(), endDate: z.string().datetime().optional(), refillLeadDays: z.number().int().min(0).max(90).default(7), nextRefillAt: z.string().datetime().optional() });
const appointment = z.object({ recipientId: recipient, doctor: z.string().trim().min(1).max(160), startsAt: z.string().datetime(), reminderMinutes: z.number().int().min(0).max(43_200).default(60), notes: z.string().trim().max(2_000).optional() });
const claim = z.object({ recipientId: recipient, billId: z.string().trim().min(1).max(128), insurer: z.string().trim().min(1).max(160), notes: z.string().trim().max(2_000).optional() });
const claimStatuses = ["submitted", "under_review", "approved", "denied", "paid"] as const;

export function createCarePlanRouter(store = new CarePlanStore()) {
  const router = Router();
  router.get("/:recipientId/calendar", (req, res) => { const from = typeof req.query.from === "string" ? req.query.from : new Date().toISOString(); const to = typeof req.query.to === "string" ? req.query.to : new Date(Date.now() + 31 * 86_400_000).toISOString(); if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) return res.status(400).json({ error: "from and to must be ISO timestamps" }); return res.json(store.calendar(req.params.recipientId, from, to)); });
  router.get("/:recipientId/medications", (req, res) => res.json(store.listSchedules(req.params.recipientId)));
  router.post("/medications", (req, res) => { const parsed = schedule.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid medication schedule", issues: parsed.error.issues }); return res.status(201).json(store.addSchedule(parsed.data)); });
  router.get("/:recipientId/appointments", (req, res) => res.json(store.listAppointments(req.params.recipientId)));
  router.post("/appointments", (req, res) => { const parsed = appointment.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid appointment", issues: parsed.error.issues }); return res.status(201).json(store.addAppointment(parsed.data)); });
  router.patch("/appointments/:id", (req, res) => { const next = req.body?.status; if (next !== "scheduled" && next !== "completed" && next !== "cancelled") return res.status(400).json({ error: "Invalid appointment status" }); const updated = store.updateAppointment(req.params.id, next); return updated ? res.json(updated) : res.status(404).json({ error: "Appointment not found" }); });
  router.get("/:recipientId/claims", (req, res) => res.json(store.listClaims(req.params.recipientId)));
  router.post("/claims", (req, res) => { const parsed = claim.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Invalid insurance claim", issues: parsed.error.issues }); return res.status(201).json(store.addClaim(parsed.data)); });
  router.patch("/claims/:id", (req, res) => { if (!claimStatuses.includes(req.body?.status)) return res.status(400).json({ error: "Invalid claim status" }); const updated = store.updateClaim(req.params.id, req.body.status, req.body.notes); return updated ? res.json(updated) : res.status(404).json({ error: "Insurance claim not found" }); });
  return router;
}
