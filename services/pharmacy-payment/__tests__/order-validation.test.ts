import { describe, it, expect } from "vitest";
import {
  MedicationOrderSchema,
  OrderAmountSchema,
} from "../validation.ts";

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

  it("rejects overlong drug names", () => {
    expect(() =>
      MedicationOrderSchema.parse({
        drug: "x".repeat(81),
        pharmacy: "Costco",
        amount: 10,
      }),
    ).toThrow();
  });
});
