import { describe, it, expect } from "vitest";
import { z } from "zod";

const OrderAmountSchema = z.union([
  z.number().min(0.01, "amount must be at least $0.01").max(10000, "amount must not exceed $10,000"),
  z.string().transform((val, ctx) => {
    const parsed = parseFloat(val);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount must be a valid number" });
      return z.NEVER;
    }
    if (parsed < 0.01) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount must be at least $0.01" });
      return z.NEVER;
    }
    if (parsed > 10000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount must not exceed $10,000" });
      return z.NEVER;
    }
    return parsed;
  }),
]);

describe("OrderAmountSchema", () => {
  it("accepts valid number amounts", () => {
    expect(OrderAmountSchema.parse(1.50)).toBe(1.50);
    expect(OrderAmountSchema.parse(0.01)).toBe(0.01);
    expect(OrderAmountSchema.parse(10000)).toBe(10000);
  });

  it("accepts valid string amounts", () => {
    expect(OrderAmountSchema.parse("1.50")).toBe(1.50);
    expect(OrderAmountSchema.parse("0.01")).toBe(0.01);
    expect(OrderAmountSchema.parse("10000")).toBe(10000);
  });

  it("rejects amount below 0.01", () => {
    expect(() => OrderAmountSchema.parse(0)).toThrow();
    expect(() => OrderAmountSchema.parse(-1)).toThrow();
    expect(() => OrderAmountSchema.parse("0")).toThrow();
  });

  it("rejects amount above 10000", () => {
    expect(() => OrderAmountSchema.parse(10000.01)).toThrow();
    expect(() => OrderAmountSchema.parse("9999999999.99")).toThrow();
  });

  it("rejects NaN", () => {
    expect(() => OrderAmountSchema.parse("abc")).toThrow();
    expect(() => OrderAmountSchema.parse("NaN")).toThrow();
  });

  it("rejects Infinity", () => {
    expect(() => OrderAmountSchema.parse("Infinity")).toThrow();
  });
});
