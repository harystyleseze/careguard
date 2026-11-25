import { describe, it, expect } from "vitest";
import {
  PRICING_DATABASE,
  getPharmacyPrices,
  getAvailableDrugs,
} from "../shared/pharmacy-pricing.ts";

// The catalog's supported ZIP tiers (issue #945).
// Every drug must have an entry for each of these (plus "default").
const SUPPORTED_ZIPS = ["90210", "10001", "33101"] as const;

describe("pharmacy-pricing zip-tier coverage", () => {
  it("every drug in the catalog has pricing for all supported ZIP codes", () => {
    const drugs = getAvailableDrugs();
    expect(drugs.length).toBeGreaterThan(0);

    const missing: string[] = [];

    for (const drug of drugs) {
      for (const zip of SUPPORTED_ZIPS) {
        if (!PRICING_DATABASE[drug][zip]) {
          missing.push(`${drug} missing zip ${zip}`);
        }
      }
      if (!PRICING_DATABASE[drug]["default"]) {
        missing.push(`${drug} missing default tier`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("querying a supported ZIP returns isFallbackZip: false for every drug", () => {
    const drugs = getAvailableDrugs();

    for (const drug of drugs) {
      for (const zip of SUPPORTED_ZIPS) {
        const result = getPharmacyPrices(drug, zip);
        expect(result.isFallbackZip).toBe(false);
        expect(result.usedZipCode).toBe(zip);
        expect(result.prices.length).toBeGreaterThan(0);
      }
    }
  });

  it("querying an unknown ZIP falls back gracefully for every drug", () => {
    const drugs = getAvailableDrugs();
    const unknownZip = "99999";

    for (const drug of drugs) {
      const result = getPharmacyPrices(drug, unknownZip);
      expect(result.isFallbackZip).toBe(true);
      expect(result.prices.length).toBeGreaterThan(0);
    }
  });

  it("zip-specific prices are distinct from one another (not duplicate data)", () => {
    const drugs = getAvailableDrugs();

    for (const drug of drugs) {
      const prices90210 = PRICING_DATABASE[drug]["90210"];
      const prices10001 = PRICING_DATABASE[drug]["10001"];
      const prices33101 = PRICING_DATABASE[drug]["33101"];

      if (!prices90210 || !prices10001 || !prices33101) continue;

      // Costco prices differ across the three ZIPs (a minimal sanity check that
      // we didn't just copy the same array three times).
      const costco90210 = prices90210.find((p) => p.id === "costco-001")?.price;
      const costco10001 = prices10001.find((p) => p.id === "costco-001")?.price;
      const costco33101 = prices33101.find((p) => p.id === "costco-001")?.price;

      // At least two of the three ZIP prices must differ.
      const allSame =
        costco90210 === costco10001 &&
        costco10001 === costco33101;
      expect(allSame).toBe(false);
    }
  });
});
