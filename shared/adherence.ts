/**
 * Medication adherence tracking.
 *
 * After a successful pharmacy order, a reminder is scheduled for `daysSupply` days later.
 * The dashboard prompts the caregiver to confirm doses. Skipped doses are tracked;
 * persistent skips (3+ consecutive) trigger a flag.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  promises as fsPromises,
} from "fs";
import { fileURLToPath } from "url";

export function getAdherenceFile(): string {
  if (process.env.ADHERENCE_LOG_FILE) return process.env.ADHERENCE_LOG_FILE;
  const dir = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch {}
  }
  return `${dir}/adherence.jsonl`;
}

import { getActiveDosageAtTime } from "./medication-history.ts";

export interface AdherenceRecord {
  id: string;
  recipientId: string;
  drug: string;
  dosage?: string;
  pharmacy: string;
  orderId: string;
  daysSupply: number;
  orderedAt: string;
  dueDate: string;
  status: "pending" | "confirmed" | "skipped" | "flagged";
  confirmedAt?: string;
  skippedCount: number;
}

export function appendAdherenceRecordSync(record: Omit<AdherenceRecord, "id">): string {
  const id = `adh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = JSON.stringify({ id, ...record }) + "\n";
  try {
    appendFileSync(getAdherenceFile(), entry);
  } catch (err: any) {
    process.stderr.write(`adherence: failed to write record: ${err?.message ?? err}\n`);
  }
  return id;
}

class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this._queue.shift();
        if (next) next();
        else this._locked = false;
      };
      if (this._locked) {
        this._queue.push(() => resolve(release));
      } else {
        this._locked = true;
        resolve(release);
      }
    });
  }
}

const adherenceMutex = new AsyncMutex();

export async function appendAdherenceRecord(record: Omit<AdherenceRecord, "id">): Promise<string> {
  const release = await adherenceMutex.acquire();
  try {
    const id = `adh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = JSON.stringify({ id, ...record }) + "\n";
    try {
      await fsPromises.appendFile(getAdherenceFile(), entry);
    } catch (err: any) {
      process.stderr.write(`adherence: failed to write record: ${err?.message ?? err}\n`);
    }
    return id;
  } finally {
    release();
  }
}

export function readAdherenceRecordsSync(): AdherenceRecord[] {
  const file = getAdherenceFile();
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function readAdherenceRecords(): Promise<AdherenceRecord[]> {
  try {
    const content = await fsPromises.readFile(getAdherenceFile(), "utf-8");
    return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function getPendingAdherences(recipientId: string): Promise<AdherenceRecord[]> {
  const records = await readAdherenceRecords();
  const now = new Date();
  return records.filter(
    (r) =>
      r.recipientId === recipientId &&
      r.status === "pending" &&
      new Date(r.dueDate) <= now
  );
}

export async function confirmAdherence(recordId: string): Promise<boolean> {
  const release = await adherenceMutex.acquire();
  try {
    const records = await readAdherenceRecords();
    const idx = records.findIndex((r) => r.id === recordId);
    if (idx === -1) return false;
    records[idx].status = "confirmed";
    records[idx].confirmedAt = new Date().toISOString();
    try {
      await rewriteAdherenceFile(records);
      return true;
    } catch {
      return false;
    }
  } finally {
    release();
  }
}

export async function skipAdherence(recordId: string): Promise<boolean> {
  const release = await adherenceMutex.acquire();
  try {
    const records = await readAdherenceRecords();
    const idx = records.findIndex((r) => r.id === recordId);
    if (idx === -1) return false;
    records[idx].status = "skipped";
    records[idx].skippedCount = (records[idx].skippedCount || 0) + 1;
    records[idx].confirmedAt = new Date().toISOString();
    if (records[idx].skippedCount >= 3) {
      records[idx].status = "flagged";
    }
    try {
      await rewriteAdherenceFile(records);
      return true;
    } catch {
      return false;
    }
  } finally {
    release();
  }
}

export async function getFlaggedAdherences(recipientId: string): Promise<AdherenceRecord[]> {
  const records = await readAdherenceRecords();
  return records.filter(
    (r) => r.recipientId === recipientId && r.status === "flagged"
  );
}

export function summarizeAdherenceRecords(
  records: readonly AdherenceRecord[],
  recipientId: string,
  now: Date = new Date(),
) {
  let total = 0;
  let confirmed = 0;
  let skipped = 0;
  let pending = 0;
  let flagged = 0;
  const pendingNow: AdherenceRecord[] = [];
  const flaggedRecords: AdherenceRecord[] = [];

  for (const record of records) {
    if (record.recipientId !== recipientId) continue;
    total++;
    if (record.status === "confirmed") confirmed++;
    if (record.status === "skipped") skipped++;
    if (record.status === "pending") {
      pending++;
      if (new Date(record.dueDate) <= now) pendingNow.push(record);
    }
    if (record.status === "flagged") {
      flagged++;
      flaggedRecords.push(record);
    }
  }

  return {
    total,
    confirmed,
    skipped,
    pending,
    flagged,
    pendingNow,
    flaggedRecords,
    adherenceRate: total > 0 ? Math.round((confirmed / total) * 100) : 100,
  };
}

export async function getAdherenceSummary(recipientId: string) {
  return summarizeAdherenceRecords(await readAdherenceRecords(), recipientId);
}

export interface AdherenceTimelineEvent {
  id: string;
  drug: string;
  dosage?: string;
  /** When the dose was confirmed/skipped, or when it falls due if still pending. */
  date: string;
  status: AdherenceRecord["status"];
}

/**
 * Dated adherence events for one recipient, oldest first, so the dashboard can
 * plot them as markers alongside logged vitals (#1237).
 * Uses the dosage active at the time of each dose (Issue #1227).
 */
export function adherenceTimeline(
  records: readonly AdherenceRecord[],
  recipientId: string,
): AdherenceTimelineEvent[] {
  return records
    .filter((r) => r.recipientId === recipientId)
    .map((r) => {
      const date = r.status === "pending" ? r.dueDate : r.confirmedAt ?? r.dueDate;
      const activeDose = r.dosage || getActiveDosageAtTime(r.recipientId, r.drug, date)?.dosage;
      return {
        id: r.id,
        drug: r.drug,
        dosage: activeDose,
        date,
        status: r.status,
      };
    })
    .filter((e) => Number.isFinite(new Date(e.date).getTime()))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function getAdherenceTimeline(recipientId: string) {
  return adherenceTimeline(await readAdherenceRecords(), recipientId);
}

export async function rewriteAdherenceFile(records: AdherenceRecord[]): Promise<void> {
  const file = getAdherenceFile();
  const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  try {
    await fsPromises.writeFile(tmp, content, "utf-8");
    await fsPromises.rename(tmp, file);
  } catch (err: any) {
    // If temp file write or rename fails, try direct overwrite or rethrow
    try {
      await fsPromises.writeFile(file, content, "utf-8");
    } catch {}
    throw err;
  }
}
