import { describe, expect, it } from "vitest";
import {
  isMultiPharmacyModeEnabled,
  resolveDrugInteractionPayTo,
} from "../pharmacy-config.ts";

describe("pharmacy wallet config", () => {
  it("uses pharmacy 1 in single-pharmacy mode", () => {
    expect(
      resolveDrugInteractionPayTo({
        MULTI_PHARMACY_MODE: "false",
        PHARMACY_1_PUBLIC_KEY: "GPHARMACY1",
      }),
    ).toBe("GPHARMACY1");
  });

  it("requires pharmacy 2 when multi-pharmacy mode is enabled", () => {
    expect(() =>
      resolveDrugInteractionPayTo({
        MULTI_PHARMACY_MODE: "true",
        PHARMACY_1_PUBLIC_KEY: "GPHARMACY1",
      }),
    ).toThrow("Missing PHARMACY_2_PUBLIC_KEY");
  });

  it("uses pharmacy 2 for drug interactions in multi-pharmacy mode", () => {
    expect(
      resolveDrugInteractionPayTo({
        MULTI_PHARMACY_MODE: "1",
        PHARMACY_1_PUBLIC_KEY: "GPHARMACY1",
        PHARMACY_2_PUBLIC_KEY: "GPHARMACY2",
      }),
    ).toBe("GPHARMACY2");
  });

  it("accepts common true-like feature flag values", () => {
    expect(isMultiPharmacyModeEnabled("1")).toBe(true);
    expect(isMultiPharmacyModeEnabled("true")).toBe(true);
    expect(isMultiPharmacyModeEnabled("yes")).toBe(true);
    expect(isMultiPharmacyModeEnabled("on")).toBe(true);
    expect(isMultiPharmacyModeEnabled("false")).toBe(false);
  });
});
