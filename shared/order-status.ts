/**
 * Medication order lifecycle tracker.
 *
 * Stores and updates the order_status field on medication transactions.
 * Status flow: submitted → ready → picked_up
 *
 * Endpoints (mounted at /agent/transactions/:txId/order-status):
 *   PATCH  — update order status (caregiver manual update)
 *   POST   /agent/order-status-webhook — pharmacy webhook endpoint
 *
 * Reminder: a cron job (see order-status-reminder.ts) fires a notification
 * if an order stays 'ready' for more than READY_REMINDER_DAYS days.
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.ts";
import { appendAuditEntry } from "./audit-log.ts";

// ── Config ────────────────────────────────────────────────────────────────────

/** Number of days before a 'ready' order triggers a pickup reminder. */
export const READY_REMINDER_DAYS =
  parseInt(process.env.ORDER_READY_REMINDER_DAYS || "3", 10);

export type OrderStatus = "submitted" | "ready" | "picked_up";

export interface OrderStatusHistoryEntry {
  status: OrderStatus;
  timestamp: string;
  updatedBy: string;
}

export interface OrderStatusRecord {
  txId: string;
  recipientId: string;
  drugName: string;
  pharmacyName: string;
  currentStatus: OrderStatus;
  history: OrderStatusHistoryEntry[];
  /** ISO timestamp of when the order last entered 'ready' state, if ever. */
  readySince?: string;
  reminderSent?: boolean;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function getOrderStatusFilePath(): string {
  const dataDir =
    process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return `${dataDir}/order-status.jsonl`;
}

function readAllOrders(): OrderStatusRecord[] {
  const file = getOrderStatusFilePath();
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf-8").trim().split("\n").filter(Boolean);
  const records: OrderStatusRecord[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
  return records;
}

function rewriteOrders(records: OrderStatusRecord[]): void {
  const file = getOrderStatusFilePath();
  writeFileSync(
    file,
    records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""),
    "utf-8",
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a new medication order when pay_for_medication completes.
 * Called by the payment tool immediately after the transaction is recorded.
 */
export function createOrderRecord(
  txId: string,
  recipientId: string,
  drugName: string,
  pharmacyName: string,
): OrderStatusRecord {
  const record: OrderStatusRecord = {
    txId,
    recipientId,
    drugName,
    pharmacyName,
    currentStatus: "submitted",
    history: [
      { status: "submitted", timestamp: new Date().toISOString(), updatedBy: "system" },
    ],
  };
  appendFileSync(getOrderStatusFilePath(), JSON.stringify(record) + "\n", "utf-8");
  return record;
}

/**
 * Update the status of an order.
 * Returns the updated record, or null if the txId is not found.
 */
export function updateOrderStatus(
  txId: string,
  newStatus: OrderStatus,
  updatedBy: string,
): OrderStatusRecord | null {
  const records = readAllOrders();
  const idx = records.findIndex((r) => r.txId === txId);
  if (idx < 0) return null;

  const record = records[idx];
  record.history.push({
    status: newStatus,
    timestamp: new Date().toISOString(),
    updatedBy,
  });
  record.currentStatus = newStatus;

  if (newStatus === "ready") {
    record.readySince = new Date().toISOString();
    record.reminderSent = false;
  } else if (newStatus === "picked_up") {
    record.reminderSent = undefined;
    record.readySince = undefined;
  }

  records[idx] = record;
  rewriteOrders(records);

  appendAuditEntry({
    event: "order.status_updated",
    actor: updatedBy,
    details: { txId, previousStatus: record.history.at(-2)?.status, newStatus },
  });

  logger.info({ txId, newStatus, updatedBy }, "[order-status] status updated");
  return record;
}

/**
 * Get the order record for a specific transaction.
 */
export function getOrderRecord(txId: string): OrderStatusRecord | null {
  return readAllOrders().find((r) => r.txId === txId) ?? null;
}

/**
 * Get all orders that have been 'ready' for more than READY_REMINDER_DAYS
 * and haven't had a reminder sent yet.
 */
export function getOverdueReadyOrders(): OrderStatusRecord[] {
  const thresholdMs = READY_REMINDER_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return readAllOrders().filter(
    (r) =>
      r.currentStatus === "ready" &&
      r.readySince &&
      !r.reminderSent &&
      now - new Date(r.readySince).getTime() > thresholdMs,
  );
}

/**
 * Mark that a reminder has been sent for an order.
 */
export function markReminderSent(txId: string): void {
  const records = readAllOrders();
  const idx = records.findIndex((r) => r.txId === txId);
  if (idx >= 0) {
    records[idx].reminderSent = true;
    rewriteOrders(records);
  }
}

// ── Express Router ────────────────────────────────────────────────────────────

const UpdateStatusSchema = z.object({
  status: z.enum(["submitted", "ready", "picked_up"]),
  updated_by: z.string().min(1).optional(),
});

// Webhook payload from pharmacy system
const PharmacyWebhookSchema = z.object({
  tx_id: z.string().min(1),
  status: z.enum(["submitted", "ready", "picked_up"]),
});

export const orderStatusRouter = Router({ mergeParams: true });

/**
 * PATCH /agent/transactions/:txId/order-status
 * Manual status update by caregiver.
 */
orderStatusRouter.patch("/", (req: Request, res: Response) => {
  const txId = req.params.txId;
  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
  }

  const updatedBy = parsed.data.updated_by ?? "caregiver";
  const record = updateOrderStatus(txId, parsed.data.status, updatedBy);
  if (!record) {
    return res.status(404).json({ error: `No order record found for transaction ${txId}` });
  }

  res.json({ success: true, order: record });
});

/**
 * GET /agent/transactions/:txId/order-status
 */
orderStatusRouter.get("/", (req: Request, res: Response) => {
  const record = getOrderRecord(req.params.txId);
  if (!record) {
    return res.status(404).json({ error: `No order record for transaction ${req.params.txId}` });
  }
  res.json(record);
});

/** Standalone webhook router — mount at /agent/order-status-webhook */
export const pharmacyWebhookRouter = Router();

/**
 * POST /agent/order-status-webhook
 * Called by the pharmacy system when an order status changes.
 */
pharmacyWebhookRouter.post("/", (req: Request, res: Response) => {
  const parsed = PharmacyWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid webhook payload", issues: parsed.error.issues });
  }

  const record = updateOrderStatus(parsed.data.tx_id, parsed.data.status, "pharmacy-webhook");
  if (!record) {
    // Accept but don't fail — the order may not exist in our store yet
    logger.warn({ txId: parsed.data.tx_id }, "[order-status] webhook for unknown txId");
    return res.status(202).json({ accepted: true, note: "tx_id not found in store" });
  }

  res.json({ success: true, order: record });
});
