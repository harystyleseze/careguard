import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDosageChange,
  getMedicationHistory,
  getActiveDosageAtTime,
} from "../shared/medication-history.ts";
import { adherenceTimeline, recordAdherenceDose } from "../shared/adherence.ts";
import { readAuditLog } from "../shared/audit-log.ts";

const RECIPIENT_ID = "test-dosage-recipient";

describe("Issue #1227: Track History of Dosage and Frequency Changes", () => {
  const MED_NAME = "Lisinopril";

  beforeEach(() => {
    // Clear recipient test data if needed
  });

  it("versions dosage and frequency edits rather than overwriting in place", () => {
    // 1. Initial dose change
    const v1 = recordDosageChange(
      {
        medicationName: MED_NAME,
        newDosage: "10mg",
        newFrequency: "Once daily",
        reason: "Initial prescription starting dose",
        prescriber: "Dr. Sarah Chen, MD",
      },
      RECIPIENT_ID,
    );

    expect(v1.id).toMatch(/^dh-/);
    expect(v1.medicationName).toBe(MED_NAME);
    expect(v1.newDosage).toBe("10mg");
    expect(v1.newFrequency).toBe("Once daily");
    expect(v1.previousDosage).toBeUndefined();

    // 2. Doctor increases dose after 2 weeks
    const v2 = recordDosageChange(
      {
        medicationName: MED_NAME,
        newDosage: "20mg",
        newFrequency: "Once daily morning",
        reason: "Doctor increased due to elevated systolic blood pressure readings",
        prescriber: "Dr. Sarah Chen, MD",
      },
      RECIPIENT_ID,
    );

    expect(v2.previousDosage).toBe("10mg");
    expect(v2.previousFrequency).toBe("Once daily");
    expect(v2.newDosage).toBe("20mg");
    expect(v2.newFrequency).toBe("Once daily morning");
    expect(v2.reason).toContain("elevated systolic");

    // 3. Inspect full history (both versions preserved chronologically, latest first)
    const history = getMedicationHistory(RECIPIENT_ID, MED_NAME);
    expect(history.length).toBe(2);
    expect(history[0].id).toBe(v2.id);
    expect(history[0].newDosage).toBe("20mg");
    expect(history[1].id).toBe(v1.id);
    expect(history[1].newDosage).toBe("10mg");
  });

  it("logs dosage adjustments to tamper-evident audit log", () => {
    const entry = recordDosageChange(
      {
        medicationName: "Metformin",
        newDosage: "1000mg",
        newFrequency: "Twice daily with meals",
        previousDosage: "500mg",
        previousFrequency: "Once daily",
        reason: "A1C target adjustment",
      },
      RECIPIENT_ID,
    );

    const logs = readAuditLog();
    const auditEntry = logs.find(
      (l) => l.event === "medication.dosage_changed" && l.details?.medicationName === "Metformin",
    );
    expect(auditEntry).toBeDefined();
    expect(auditEntry?.details?.newDosage).toBe("1000mg");
    expect(auditEntry?.details?.previousDosage).toBe("500mg");
  });

  it("resolves active dosage at the exact time of historical doses for adherence calculations", () => {
    const drug = "Atorvastatin";
    const t0 = new Date("2026-01-01T08:00:00Z").getTime();
    const tChange = new Date("2026-06-01T08:00:00Z").getTime();
    const tAfter = new Date("2026-08-01T08:00:00Z").getTime();

    // Baseline dose recorded in Jan 2026
    recordDosageChange(
      {
        medicationName: drug,
        newDosage: "10mg",
        newFrequency: "Daily",
        reason: "Initial statin therapy",
        changedAt: new Date(t0).toISOString(),
      },
      RECIPIENT_ID,
    );

    // Dose increased in June 2026
    recordDosageChange(
      {
        medicationName: drug,
        newDosage: "40mg",
        newFrequency: "Daily evening",
        reason: "Target LDL cholesterol reduction",
        changedAt: new Date(tChange).toISOString(),
      },
      RECIPIENT_ID,
    );

    // Active dosage in March 2026 should be resolved as 10mg
    const dosageInMarch = getActiveDosageAtTime(RECIPIENT_ID, drug, new Date("2026-03-15").getTime());
    // Active dosage in July 2026 should be resolved as 40mg
    const dosageInJuly = getActiveDosageAtTime(RECIPIENT_ID, drug, new Date("2026-07-15").getTime());

    expect(dosageInMarch?.dosage).toBe("10mg");
    expect(dosageInJuly?.dosage).toBe("40mg");
  });

  it("exhibits no behavior change for medications that have never been edited", () => {
    const uneditedDrug = "NeverEditedMedication";
    const history = getMedicationHistory(RECIPIENT_ID, uneditedDrug);
    expect(history).toEqual([]);

    const activeDosage = getActiveDosageAtTime(RECIPIENT_ID, uneditedDrug, Date.now());
    expect(activeDosage).toBeUndefined(); // graceful fallback, no error thrown
  });
});
