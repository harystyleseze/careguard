/**
 * Medication Dosage & Frequency Change History Tracking (Issue #1227)
 *
 * Implements immutable versioning of dosage and frequency modifications.
 * Allows caregivers to trace when dosage was altered, reasons for changes,
 * and enables dosage-version-aware adherence calculations.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { appendAuditEntry } from "./audit-log.ts";
import { logger } from "./logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");

export interface DosageChangeRecord {
  id: string;
  drug: string;
  medicationName: string;
  previousDosage?: string;
  previousFrequency?: string;
  newDosage: string;
  newFrequency: string;
  changedAt: string; // ISO 8601
  reason?: string;
  prescriber?: string;
}

export interface DosageChangeInput {
  drug?: string;
  medicationName?: string;
  previousDosage?: string;
  previousFrequency?: string;
  newDosage: string;
  newFrequency: string;
  changedAt?: string;
  reason?: string;
  prescriber?: string;
  recipientId?: string;
}

function getHistoryFilePath(recipientId: string = "rosa"): string {
  const cleanId = typeof recipientId === "string" && recipientId.trim() ? recipientId.trim() : "rosa";
  const recipientDir = join(DATA_DIR, "recipients", cleanId);
  if (!existsSync(recipientDir)) {
    mkdirSync(recipientDir, { recursive: true });
  }
  return join(recipientDir, "medication_history.json");
}

/**
 * Load dosage change history for a recipient.
 * Time Complexity: O(H log H) sorting or O(H) filtering
 * Space Complexity: O(H)
 */
export function getMedicationHistory(
  recipientId: string = "rosa",
  drugName?: string,
): DosageChangeRecord[] {
  const cleanRecipientId = typeof recipientId === "string" ? recipientId : "rosa";
  const filePath = getHistoryFilePath(cleanRecipientId);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const records = JSON.parse(raw) as any[];
    if (!Array.isArray(records)) return [];

    const mapped: DosageChangeRecord[] = records.map((r) => ({
      id: r.id,
      drug: r.drug || r.medicationName || "",
      medicationName: r.medicationName || r.drug || "",
      previousDosage: r.previousDosage || undefined,
      previousFrequency: r.previousFrequency || undefined,
      newDosage: r.newDosage,
      newFrequency: r.newFrequency,
      changedAt: r.changedAt,
      reason: r.reason || undefined,
      prescriber: r.prescriber || undefined,
    }));

    if (drugName) {
      const normalized = drugName.trim().toLowerCase();
      return mapped
        .filter((r) => r.drug.toLowerCase() === normalized || r.medicationName.toLowerCase() === normalized)
        .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
    }

    return mapped.sort(
      (a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime(),
    );
  } catch (err: any) {
    logger.warn({ err: err?.message, recipientId: cleanRecipientId }, "Failed to load medication history");
    return [];
  }
}

/**
 * Record an immutable dosage or frequency version change for a medication.
 * Accepts either:
 * - recordDosageChange(entryObject, recipientId)
 * - recordDosageChange(recipientId, paramsObject)
 *
 * Time Complexity: O(H) where H is history entries.
 * Space Complexity: O(H)
 */
export function recordDosageChange(
  arg1: string | DosageChangeInput,
  arg2?: string | DosageChangeInput,
): DosageChangeRecord {
  let recipientId = "rosa";
  let params: DosageChangeInput;

  if (typeof arg1 === "string") {
    recipientId = arg1;
    params = (arg2 as DosageChangeInput) || ({} as DosageChangeInput);
  } else {
    params = arg1 || ({} as DosageChangeInput);
    if (typeof arg2 === "string") {
      recipientId = arg2;
    } else if (params.recipientId) {
      recipientId = params.recipientId;
    }
  }

  const drug = (params.medicationName || params.drug || "").trim();
  const filePath = getHistoryFilePath(recipientId);
  const currentHistory = getMedicationHistory(recipientId);

  // If previous dosage not specified, resolve from latest history entry
  const drugHistory = currentHistory.filter(
    (h) => h.drug.toLowerCase() === drug.toLowerCase() || h.medicationName.toLowerCase() === drug.toLowerCase(),
  );
  const previousDosage =
    params.previousDosage !== undefined
      ? params.previousDosage
      : drugHistory[0]?.newDosage || undefined;
  const previousFrequency =
    params.previousFrequency !== undefined
      ? params.previousFrequency
      : drugHistory[0]?.newFrequency || undefined;

  const entry: DosageChangeRecord = {
    id: `dh-${Date.now()}-${randomUUID().slice(0, 8)}`,
    drug,
    medicationName: drug,
    previousDosage,
    previousFrequency,
    newDosage: params.newDosage.trim(),
    newFrequency: params.newFrequency.trim(),
    changedAt: params.changedAt || new Date().toISOString(),
    reason: params.reason?.trim() || undefined,
    prescriber: params.prescriber?.trim() || undefined,
  };

  const updatedHistory = [...currentHistory, entry];
  writeFileSync(filePath, JSON.stringify(updatedHistory, null, 2), "utf-8");

  appendAuditEntry({
    event: "medication.dosage_changed",
    actor: "caregiver",
    details: {
      recipientId,
      drug: entry.drug,
      medicationName: entry.medicationName,
      previousDosage: entry.previousDosage,
      previousFrequency: entry.previousFrequency,
      newDosage: entry.newDosage,
      newFrequency: entry.newFrequency,
      reason: entry.reason,
      prescriber: entry.prescriber,
    },
  });

  logger.info(
    { drug: entry.drug, from: entry.previousDosage, to: entry.newDosage, recipientId },
    "[medication-history] recorded versioned dosage adjustment",
  );

  return entry;
}

/**
 * Determine the active dosage and frequency that was in effect at a specific timestamp.
 * Adherence calculations use this to correlate patient dose events with the active prescription.
 *
 * Time Complexity: O(H log H) to sort history chronologically, or O(H) linear scan.
 * Space Complexity: O(1) auxiliary space.
 */
export function getActiveDosageAtTime(
  recipientId: string = "rosa",
  drugName: string,
  targetTime: string | number | Date,
  fallbackDosage?: string,
  fallbackFrequency: string = "daily",
): { dosage: string; frequency: string } | undefined {
  const history = getMedicationHistory(recipientId, drugName);
  if (!history || history.length === 0) {
    if (!fallbackDosage) return undefined;
    return { dosage: fallbackDosage, frequency: fallbackFrequency };
  }

  // Sort chronological ascending (oldest first)
  const chronological = [...history].sort(
    (a, b) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime(),
  );

  const targetMs =
    typeof targetTime === "number"
      ? targetTime
      : new Date(targetTime).getTime();

  // If before the first recorded change, the dosage was the first change's previousDosage (or newDosage if no previous)
  if (targetMs < new Date(chronological[0].changedAt).getTime()) {
    const prev = chronological[0].previousDosage || chronological[0].newDosage;
    const prevFreq = chronological[0].previousFrequency || chronological[0].newFrequency;
    return {
      dosage: prev,
      frequency: prevFreq,
    };
  }

  // Find the latest change that happened on or before targetMs
  let active = {
    dosage: chronological[0].newDosage,
    frequency: chronological[0].newFrequency,
  };

  for (const record of chronological) {
    if (new Date(record.changedAt).getTime() <= targetMs) {
      active = {
        dosage: record.newDosage,
        frequency: record.newFrequency,
      };
    } else {
      break;
    }
  }

  return active;
}
