import { describe, expect, it } from "vitest";
import { buildInteractionIndex, checkInteractions, type Interaction } from "../logic.ts";

describe("interaction index", () => {
  it("finds a normalized pair regardless of medication order", () => {
    const interactions: Interaction[] = [{
      drugs: ["Drug A", "DRUG B"],
      severity: "severe",
      description: "test interaction",
      recommendation: "avoid",
    }];
    const result = checkInteractions([" drug b ", "DRUG A"], buildInteractionIndex(interactions));
    expect(result.interactionCount).toBe(1);
    expect(result.overallRisk).toBe("high");
  });

  it("capitalizes every word and both sides of a hyphen", () => {
    const interactions: Interaction[] = [{
      drugs: ["vitamin d", "co-amoxiclav"],
      severity: "moderate",
      description: "test interaction",
      recommendation: "consult a clinician",
    }];

    const result = checkInteractions(
      ["VITAMIN D", "CO-AMOXICLAV"],
      buildInteractionIndex(interactions),
    );

    expect(result.medications).toEqual(["Vitamin D", "Co-Amoxiclav"]);
    expect(result.interactions[0]).toMatchObject({
      drug1: "Vitamin D",
      drug2: "Co-Amoxiclav",
    });
  });

  it("continues to title-case single-word medication names", () => {
    const result = checkInteractions(["LISINOPRIL", "POTASSIUM"]);

    expect(result.medications).toEqual(["Lisinopril", "Potassium"]);
  });
});
