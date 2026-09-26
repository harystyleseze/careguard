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
});
