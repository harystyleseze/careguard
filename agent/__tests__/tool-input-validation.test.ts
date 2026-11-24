import { describe, expect, it, vi } from "vitest";
import { TOOL_INPUT_SCHEMAS, validateToolInput } from "../tool-input-validation.ts";

describe("validateToolInput (#1312)", () => {
  it("accepts valid input and returns the parsed data", () => {
    expect(
      validateToolInput("compare_pharmacy_prices", { drug_name: "Lisinopril", dosage: "10mg" }),
    ).toEqual({ drug_name: "Lisinopril", dosage: "10mg" });
  });

  it("rejects unknown fields and missing required fields", () => {
    expect(() =>
      validateToolInput("compare_pharmacy_prices", { drug_name: "A", dosage: "1mg", extra: 1 }),
    ).toThrow(/unknown field\(s\) not allowed: extra/);
    expect(() => validateToolInput("check_drug_interactions", {})).toThrow(/medications/);
    expect(() => validateToolInput("no_such_tool", {})).toThrow(/Unknown tool/);
  });

  it("reuses module-level schemas instead of recompiling per call", () => {
    const schema = TOOL_INPUT_SCHEMAS.compare_pharmacy_prices;
    const parseSpy = vi.spyOn(schema, "safeParse");
    for (let i = 0; i < 3; i++) {
      validateToolInput("compare_pharmacy_prices", { drug_name: "Lisinopril", dosage: "10mg" });
    }
    // Every call went through the same cached schema instance.
    expect(parseSpy).toHaveBeenCalledTimes(3);
    expect(TOOL_INPUT_SCHEMAS.compare_pharmacy_prices).toBe(schema);
    parseSpy.mockRestore();
  });
});
