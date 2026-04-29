import { describe, expect, it } from "vitest";
import { validatePolicy } from "../lib/schemas";

const valid = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 200,
  approvalThreshold: 75,
};

describe("validatePolicy", () => {
  it("accepts a valid policy", () => {
    const r = validatePolicy(valid);
    expect(r.isValid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("rejects negative dailyLimit", () => {
    const r = validatePolicy({ ...valid, dailyLimit: -1 });
    expect(r.isValid).toBe(false);
    expect(r.errors.find((e) => e.field === "dailyLimit")).toBeDefined();
  });

  it("accepts zero values", () => {
    const r = validatePolicy({ ...valid, monthlyLimit: 0 });
    expect(r.isValid).toBe(true);
  });

  it("rejects values over 10000", () => {
    const r = validatePolicy({ ...valid, monthlyLimit: 10001 });
    expect(r.isValid).toBe(false);
    expect(
      r.errors.some(
        (e) => e.field === "monthlyLimit" && /10000/.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects NaN coerced from non-numeric input", () => {
    const r = validatePolicy({ ...valid, dailyLimit: Number.NaN });
    expect(r.isValid).toBe(false);
  });

  it("rejects dailyLimit greater than monthlyLimit", () => {
    const r = validatePolicy({ ...valid, dailyLimit: 600 });
    expect(r.isValid).toBe(false);
    expect(
      r.errors.some(
        (e) => e.field === "dailyLimit" && /monthly/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("rejects approvalThreshold greater than smallest cap", () => {
    const r = validatePolicy({ ...valid, approvalThreshold: 200 });
    expect(r.isValid).toBe(false);
    expect(
      r.errors.some(
        (e) =>
          e.field === "approvalThreshold" && /smallest budget cap/i.test(e.message),
      ),
    ).toBe(true);
  });

  it("warns when category budgets exceed 120% of monthly limit", () => {
    const r = validatePolicy({
      ...valid,
      medicationMonthlyBudget: 400,
      billMonthlyBudget: 400,
    });
    expect(r.isValid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("rejects missing fields", () => {
    const r = validatePolicy({ dailyLimit: 100 });
    expect(r.isValid).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validatePolicy(null).isValid).toBe(false);
    expect(validatePolicy("hello").isValid).toBe(false);
    expect(validatePolicy(undefined).isValid).toBe(false);
  });
});
