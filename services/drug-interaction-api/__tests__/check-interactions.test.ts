import { describe, expect, it } from "vitest";
import { checkInteractions } from "../logic.ts";

describe("checkInteractions", () => {
  it.each([
    ["all lowercase", ["lisinopril", "ibuprofen", "metformin"]],
    ["all uppercase", ["LISINOPRIL", "IBUPROFEN", "METFORMIN"]],
    ["mixed case", ["lIsInOpRiL", "Ibuprofen", "MetFORMIN"]],
  ])("returns the same title-cased output for %s input", (_label, medications) => {
    const result = checkInteractions(medications);

    expect(result.medications).toEqual(["Lisinopril", "Ibuprofen", "Metformin"]);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0]).toMatchObject({
      drug1: "Lisinopril",
      drug2: "Ibuprofen",
      severity: "moderate",
    });
  });

  it("title-cases medications even when no interaction is found", () => {
    const result = checkInteractions(["  aToRvAsTaTiN  ", "unknown drug"]);

    expect(result.medications).toEqual(["Atorvastatin", "Unknown Drug"]);
    expect(result.interactions).toEqual([]);
  });
});
