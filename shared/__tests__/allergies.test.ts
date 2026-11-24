import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecipientAllergies,
  saveRecipientAllergies,
  addRecipientAllergy,
  removeRecipientAllergy,
  checkMedicationAllergies,
} from "../allergies.ts";
import type { RecipientAllergy } from "../types.ts";

describe("Allergies & Adverse Reactions (Issue #1230)", () => {
  const testRecipient = "test-recipient-rosa";

  beforeEach(() => {
    // Reset test recipient allergies
    const initialAllergies: RecipientAllergy[] = [
      {
        id: "test-allergy-penicillin",
        substance: "Penicillin",
        severity: "severe",
        reaction: "Anaphylaxis and hives",
        notes: "Confirmed in 2020",
        createdAt: new Date().toISOString(),
      },
      {
        id: "test-allergy-aspirin",
        substance: "Aspirin",
        severity: "moderate",
        reaction: "Mild stomach upset and heartburn",
        notes: "Take with food if needed",
        createdAt: new Date().toISOString(),
      },
    ];
    saveRecipientAllergies(initialAllergies, testRecipient);
  });

  it("loads recipient allergies correctly", () => {
    const list = loadRecipientAllergies(testRecipient);
    expect(list.length).toBe(2);
    expect(list[0].substance).toBe("Penicillin");
    expect(list[0].severity).toBe("severe");
  });

  it("adds a new allergy entry", () => {
    const created = addRecipientAllergy(
      {
        substance: "Sulfa",
        severity: "life_threatening",
        reaction: "Severe rash / Stevens-Johnson risk",
        notes: "Strict allergy",
      },
      testRecipient,
    );

    expect(created.id).toBeDefined();
    expect(created.substance).toBe("Sulfa");

    const updated = loadRecipientAllergies(testRecipient);
    expect(updated.length).toBe(3);
    expect(updated.some((a) => a.substance === "Sulfa")).toBe(true);
  });

  it("removes an allergy entry by id", () => {
    const removed = removeRecipientAllergy("test-allergy-aspirin", testRecipient);
    expect(removed).toBe(true);

    const list = loadRecipientAllergies(testRecipient);
    expect(list.length).toBe(1);
    expect(list.some((a) => a.id === "test-allergy-aspirin")).toBe(false);
  });

  it("blocks severe and life-threatening allergies for exact drug matches", () => {
    const res = checkMedicationAllergies("Penicillin VK 500mg", testRecipient);
    expect(res.safe).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.conflicts.length).toBeGreaterThan(0);
    expect(res.conflicts[0].severity).toBe("severe");
    expect(res.summary).toContain("BLOCKED");
  });

  it("blocks cross-reactive drugs within the same class (e.g. Amoxicillin for Penicillin allergy)", () => {
    const res = checkMedicationAllergies("Amoxicillin 250mg", testRecipient);
    expect(res.safe).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.conflicts.some((c) => c.allergy.substance === "Penicillin")).toBe(true);
  });

  it("issues warning without blocking for mild or moderate sensitivities", () => {
    const res = checkMedicationAllergies("Aspirin 81mg", testRecipient);
    expect(res.safe).toBe(true);
    expect(res.blocked).toBe(false);
    expect(res.warning).toBe(true);
    expect(res.conflicts.length).toBeGreaterThan(0);
    expect(res.conflicts[0].severity).toBe("moderate");
    expect(res.summary).toContain("WARNING");
  });

  it("returns safe when medications do not match any documented allergies", () => {
    const res = checkMedicationAllergies(["Lisinopril", "Metformin"], testRecipient);
    expect(res.safe).toBe(true);
    expect(res.blocked).toBe(false);
    expect(res.warning).toBe(false);
    expect(res.conflicts.length).toBe(0);
  });
});
