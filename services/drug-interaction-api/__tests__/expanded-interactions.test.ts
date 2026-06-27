import { describe, it, expect } from "vitest";
import { checkInteractions, INTERACTIONS } from "../logic";

describe("Expanded Drug Interactions Database", () => {
  it("should contain at least 500 entries in the database", () => {
    expect(INTERACTIONS.length).toBeGreaterThanOrEqual(500);
  });

  it("should resolve warfarin + aspirin correctly (severe interaction)", () => {
    const result = checkInteractions(["warfarin", "aspirin"]);
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("high");
    expect(result.interactions[0].severity).toBe("severe");
    expect(result.interactions[0].description).toContain("bleeding");
  });

  it("should resolve lisinopril + potassium chloride correctly (severe interaction)", () => {
    const result = checkInteractions(["lisinopril", "potassium chloride"]);
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("high");
    expect(result.interactions[0].severity).toBe("severe");
    expect(result.interactions[0].description).toContain("hyperkalemia");
  });

  it("should resolve metformin + alcohol correctly (severe interaction)", () => {
    const result = checkInteractions(["metformin", "alcohol"]);
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("high");
    expect(result.interactions[0].severity).toBe("severe");
    expect(result.interactions[0].description).toContain("acidosis");
  });

  it("should resolve sertraline + ibuprofen correctly (moderate interaction)", () => {
    const result = checkInteractions(["sertraline", "ibuprofen"]);
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("moderate");
    expect(result.interactions[0].severity).toBe("moderate");
    expect(result.interactions[0].description).toContain("GI bleeding");
  });

  it("should resolve metformin + omeprazole correctly (mild interaction)", () => {
    const result = checkInteractions(["metformin", "omeprazole"]);
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("low");
    expect(result.interactions[0].severity).toBe("mild");
    expect(result.interactions[0].description).toContain("B12");
  });

  it("should return no interactions for unrelated drugs", () => {
    const result = checkInteractions(["omeprazole", "lisinopril"]);
    expect(result.interactionCount).toBe(0);
    expect(result.overallRisk).toBe("none");
  });
});
