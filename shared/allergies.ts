/**
 * Recipient Allergy & Adverse Reaction Management (Issue #1230)
 *
 * Dedicated allergy records consulted independently before any new medication
 * is ordered or added. Operates in addition to drug-to-drug interaction checks.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  RecipientAllergySchema,
  type AllergySeverity,
  type RecipientAllergy,
} from "./types.ts";
import { logger } from "./logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data");

/**
 * Common cross-reactive drug classes for substance matching.
 * Maps substance keywords (lowercase) to known drug ingredients and brand names.
 */
const KNOWN_CROSS_REACTIVITY: Record<string, string[]> = {
  penicillin: [
    "penicillin",
    "amoxicillin",
    "ampicillin",
    "augmentin",
    "piperacillin",
    "dicloxacillin",
    "oxacillin",
  ],
  sulfa: [
    "sulfa",
    "sulfamethoxazole",
    "bactrim",
    "septra",
    "sulfasalazine",
    "sulfisoxazole",
    "dapsone",
  ],
  aspirin: [
    "aspirin",
    "acetylsalicylic",
    "ibuprofen",
    "advil",
    "motrin",
    "naproxen",
    "aleve",
    "meloxicam",
    "celecoxib",
    "diclofenac",
  ],
  nsaid: [
    "aspirin",
    "ibuprofen",
    "advil",
    "motrin",
    "naproxen",
    "aleve",
    "meloxicam",
    "indomethacin",
    "ketorolac",
    "celecoxib",
  ],
  codeine: [
    "codeine",
    "morphine",
    "hydrocodone",
    "oxycodone",
    "percocet",
    "vicodin",
    "hydromorphone",
    "tramadol",
  ],
  statin: [
    "atorvastatin",
    "lipitor",
    "simvastatin",
    "zocor",
    "rosuvastatin",
    "crestor",
    "pravastatin",
    "lovastatin",
  ],
  ace_inhibitor: [
    "lisinopril",
    "prinivil",
    "zestril",
    "enalapril",
    "ramipril",
    "captopril",
    "benazepril",
  ],
};

export interface AllergyConflict {
  medication: string;
  allergy: RecipientAllergy;
  severity: AllergySeverity;
  reason: string;
}

export interface AllergyCheckResult {
  safe: boolean;
  blocked: boolean;
  warning: boolean;
  hasAllergies: boolean;
  conflicts: AllergyConflict[];
  summary: string;
}

export function getAllergiesFilePath(recipientId: string = "rosa"): string {
  const recipientDir = join(DATA_DIR, "recipients", recipientId);
  if (!existsSync(recipientDir)) {
    mkdirSync(recipientDir, { recursive: true });
  }
  return join(recipientDir, "allergies.json");
}

/**
 * Loads all allergy records for the given care recipient.
 * Time Complexity: O(A) parsing JSON
 * Space Complexity: O(A)
 */
export function loadRecipientAllergies(
  recipientId: string = "rosa",
): RecipientAllergy[] {
  const filePath = getAllergiesFilePath(recipientId);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const res = RecipientAllergySchema.safeParse(item);
        return res.success ? res.data : null;
      })
      .filter((item): item is RecipientAllergy => item !== null);
  } catch (err: any) {
    logger.warn(
      { err: err?.message, recipientId },
      "failed to read allergies.json, returning empty",
    );
    return [];
  }
}

/**
 * Saves allergy records atomically for the given care recipient.
 */
export function saveRecipientAllergies(
  allergies: RecipientAllergy[],
  recipientId: string = "rosa",
): void {
  const filePath = getAllergiesFilePath(recipientId);
  const validated = allergies.map((a) => RecipientAllergySchema.parse(a));
  writeFileSync(filePath, JSON.stringify(validated, null, 2), "utf-8");
}

/**
 * Adds an allergy entry to the recipient record.
 */
export function addRecipientAllergy(
  allergyInput: Omit<RecipientAllergy, "id" | "createdAt">,
  recipientId: string = "rosa",
): RecipientAllergy {
  const current = loadRecipientAllergies(recipientId);
  const newEntry: RecipientAllergy = {
    id: `allergy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    substance: allergyInput.substance.trim(),
    severity: allergyInput.severity,
    reaction: allergyInput.reaction?.trim(),
    notes: allergyInput.notes?.trim(),
    createdAt: new Date().toISOString(),
  };

  current.push(newEntry);
  saveRecipientAllergies(current, recipientId);
  logger.info({ recipientId, substance: newEntry.substance }, "added allergy record");
  return newEntry;
}

/**
 * Removes an allergy entry by ID.
 */
export function removeRecipientAllergy(
  allergyId: string,
  recipientId: string = "rosa",
): boolean {
  const current = loadRecipientAllergies(recipientId);
  const filtered = current.filter((a) => a.id !== allergyId);
  if (filtered.length === current.length) return false;
  saveRecipientAllergies(filtered, recipientId);
  logger.info({ recipientId, allergyId }, "removed allergy record");
  return true;
}

/**
 * Evaluates whether a target drug matches an allergy substance or its known cross-reactives.
 */
function isSubstanceMatch(drugName: string, allergySubstance: string): boolean {
  const dNorm = drugName.toLowerCase().trim();
  const aNorm = allergySubstance.toLowerCase().trim();

  // Direct substring or inclusion
  if (dNorm.includes(aNorm) || aNorm.includes(dNorm)) {
    return true;
  }

  // Cross-reactivity table evaluation
  for (const [classKey, members] of Object.entries(KNOWN_CROSS_REACTIVITY)) {
    const allergyMatchesClass = aNorm.includes(classKey) || members.some((m) => aNorm.includes(m));
    const drugMatchesClass = dNorm.includes(classKey) || members.some((m) => dNorm.includes(m));
    if (allergyMatchesClass && drugMatchesClass) {
      return true;
    }
  }

  return false;
}

/**
 * Checks one or more medications against the recipient's allergy list.
 *
 * Clinical Rule (Issue #1230):
 * - Severe / Life-Threatening: BLOCKS payment or ordering (safe = false, blocked = true).
 * - Mild / Moderate: Issues warning banner without hard block (safe = true, warning = true).
 *
 * Time Complexity: O(M * A)
 * Space Complexity: O(C) where C is conflicts found
 */
export function checkMedicationAllergies(
  medications: string | string[],
  recipientId: string = "rosa",
): AllergyCheckResult {
  const meds = Array.isArray(medications) ? medications : [medications];
  const allergies = loadRecipientAllergies(recipientId);

  if (allergies.length === 0 || meds.length === 0) {
    return {
      safe: true,
      blocked: false,
      warning: false,
      hasAllergies: allergies.length > 0,
      conflicts: [],
      summary: "No allergy conflicts detected.",
    };
  }

  const conflicts: AllergyConflict[] = [];

  for (const med of meds) {
    if (!med || typeof med !== "string") continue;
    for (const allergy of allergies) {
      if (isSubstanceMatch(med, allergy.substance)) {
        const isSevereOrFatal =
          allergy.severity === "severe" || allergy.severity === "life_threatening";
        const reason = isSevereOrFatal
          ? `Contraindicated: Patient has documented ${allergy.severity.replace("_", "-")} allergy to ${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}.`
          : `Precaution: Patient has documented ${allergy.severity} sensitivity to ${allergy.substance}${allergy.reaction ? ` (${allergy.reaction})` : ""}.`;

        conflicts.push({
          medication: med,
          allergy,
          severity: allergy.severity,
          reason,
        });
      }
    }
  }

  const blocked = conflicts.some(
    (c) => c.severity === "severe" || c.severity === "life_threatening",
  );
  const warning = conflicts.length > 0 && !blocked;
  const safe = !blocked;

  const summary = conflicts.length === 0
    ? "No allergy conflicts detected."
    : blocked
      ? `BLOCKED: Found ${conflicts.length} high-risk allergy conflict(s) with recipient's allergy profile.`
      : `WARNING: Found ${conflicts.length} moderate/mild allergy caution(s) with recipient's allergy profile.`;

  return {
    safe,
    blocked,
    warning,
    hasAllergies: true,
    conflicts,
    summary,
  };
}
