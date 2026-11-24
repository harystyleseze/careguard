import { describe, it, expect } from "vitest";
import {
  MedicationOrderSchema,
  OrderAmountSchema,
  isKnownDrugPharmacyPair,
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

  it("rejects string amounts with trailing garbage", () => {
    expect(() => OrderAmountSchema.parse("10abc")).toThrow();
    expect(() => OrderAmountSchema.parse("5.00x")).toThrow();
    expect(() => OrderAmountSchema.parse("10 ")).toThrow();
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

describe("isKnownDrugPharmacyPair (Issue #927)", () => {
  it("accepts known drug/pharmacy pairs from the catalog", () => {
    expect(isKnownDrugPharmacyPair("lisinopril", "Costco Pharmacy")).toBe(true);
    expect(isKnownDrugPharmacyPair("metformin", "CVS Pharmacy")).toBe(true);
    expect(isKnownDrugPharmacyPair("atorvastatin", "Walgreens")).toBe(true);
  });

  it("matches drug/pharmacy case-insensitively", () => {
    expect(isKnownDrugPharmacyPair("LISINOPRIL", "costco pharmacy")).toBe(true);
    expect(isKnownDrugPharmacyPair("  Lisinopril  ", "  Costco Pharmacy  ")).toBe(true);
  });

  it("rejects fabricated drug/pharmacy pairs", () => {
    expect(isKnownDrugPharmacyPair("Fabricatol", "Fake Pharmacy")).toBe(false);
    expect(isKnownDrugPharmacyPair("lisinopril", "Nonexistent Pharmacy")).toBe(false);
    expect(isKnownDrugPharmacyPair("Nonexistent Drug", "CVS Pharmacy")).toBe(false);
    expect(isKnownDrugPharmacyPair("", "CVS Pharmacy")).toBe(false);
  });
});
