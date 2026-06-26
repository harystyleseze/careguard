/**
 * Medication adherence tracking.
 *
 * After a successful pharmacy order, a reminder is scheduled for `daysSupply` days later.
 * The dashboard prompts the caregiver to confirm doses. Skipped doses are tracked;
 * persistent skips (3+ consecutive) trigger a flag.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data");
const ADHERENCE_FILE = `${DATA_DIR}/adherence.jsonl`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export interface AdherenceRecord {
  id: string;
  recipientId: string;
  drug: string;
  pharmacy: string;
  orderId: string;
  daysSupply: number;
  orderedAt: string;
  dueDate: string;
  status: "pending" | "confirmed" | "skipped" | "flagged";
  confirmedAt?: string;
  skippedCount: number;
}

export function appendAdherenceRecord(record: Omit<AdherenceRecord, "id">): string {
  const id = `adh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = JSON.stringify({ id, ...record }) + "\n";
  try {
    appendFileSync(ADHERENCE_FILE, entry);
  } catch (err: any) {
    process.stderr.write(`adherence: failed to write record: ${err?.message ?? err}\n`);
  }
  return id;
}

export function readAdherenceRecords(): AdherenceRecord[] {
  if (!existsSync(ADHERENCE_FILE)) return [];
  try {
    const content = readFileSync(ADHERENCE_FILE, "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function getPendingAdherences(recipientId: string): AdherenceRecord[] {
  const records = readAdherenceRecords();
  const now = new Date();
  return records.filter(
    (r) =>
      r.recipientId === recipientId &&
      r.status === "pending" &&
      new Date(r.dueDate) <= now
  );
}

export function confirmAdherence(recordId: string): boolean {
  const records = readAdherenceRecords();
  const idx = records.findIndex((r) => r.id === recordId);
  if (idx === -1) return false;
  records[idx].status = "confirmed";
  records[idx].confirmedAt = new Date().toISOString();
  rewriteAdherenceFile(records);
  return true;
}

export function skipAdherence(recordId: string): boolean {
  const records = readAdherenceRecords();
  const idx = records.findIndex((r) => r.id === recordId);
  if (idx === -1) return false;
  records[idx].status = "skipped";
  records[idx].skippedCount = (records[idx].skippedCount || 0) + 1;
  records[idx].confirmedAt = new Date().toISOString();
  if (records[idx].skippedCount >= 3) {
    records[idx].status = "flagged";
  }
  rewriteAdherenceFile(records);
  return true;
}

export function getFlaggedAdherences(recipientId: string): AdherenceRecord[] {
  return readAdherenceRecords().filter(
    (r) => r.recipientId === recipientId && r.status === "flagged"
  );
}

export function getAdherenceSummary(recipientId: string) {
  const records = readAdherenceRecords().filter((r) => r.recipientId === recipientId);
  const total = records.length;
  const confirmed = records.filter((r) => r.status === "confirmed").length;
  const skipped = records.filter((r) => r.status === "skipped").length;
  const pending = records.filter((r) => r.status === "pending").length;
  const flagged = records.filter((r) => r.status === "flagged").length;
  const pendingNow = getPendingAdherences(recipientId);
  return {
    total,
    confirmed,
    skipped,
    pending,
    flagged,
    pendingNow,
    adherenceRate: total > 0 ? Math.round((confirmed / total) * 100) : 100,
  };
}

function rewriteAdherenceFile(records: AdherenceRecord[]) {
  writeFileSync(ADHERENCE_FILE, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
