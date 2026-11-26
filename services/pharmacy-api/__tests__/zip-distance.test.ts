/**
 * Real production tests for zip code distance filtering and formatting (#910).
 *
 * Verifies that:
 * - zipCode parameter affects real pharmacy distance results from getPharmacyPrices()
 * - Different zip codes produce different location-specific distances
 * - buildCompareResponse properly parses and formats string distances into 1-decimal numbers
 * - Fallback flags and default zip code behaviors work as expected
 */

import { describe, it, expect } from "vitest";
import {
  getPharmacyPrices,
  DEFAULT_ZIP_CODE,
} from "../../../shared/pharmacy-pricing.ts";
import {
  buildCompareResponse,
  PharmacyCompareResponseSchema,
} from "../logic.ts";

describe("Zip code distance calculation and formatting (#910)", () => {
  it("different zip codes produce different distances for the same pharmacy", () => {
    const zip90210 = getPharmacyPrices("lisinopril", "90210");
    const zip10001 = getPharmacyPrices("lisinopril", "10001");
    const zip33101 = getPharmacyPrices("lisinopril", "33101");

    const costco90210 = zip90210.prices.find((p) => p.id === "costco-001");
    const costco10001 = zip10001.prices.find((p) => p.id === "costco-001");
    const costco33101 = zip33101.prices.find((p) => p.id === "costco-001");

    expect(costco90210?.distance).toBe("2.1 mi");
    expect(costco10001?.distance).toBe("3.5 mi");
    expect(costco33101?.distance).toBe("4.0 mi");

    expect(costco90210?.distance).not.toBe(costco10001?.distance);
    expect(costco10001?.distance).not.toBe(costco33101?.distance);
  });

  it("distance varies across distinct pharmacies within the same zip code", () => {
    const query = getPharmacyPrices("lisinopril", "90210");
    const distances = query.prices.map((p) => p.distance);

    // In 90210: CVS is 0.5 mi, Walgreens is 0.8 mi, Walmart is 1.8 mi, Costco is 2.1 mi, Rite Aid is 3.2 mi
    expect(distances).toContain("0.5 mi");
    expect(distances).toContain("0.8 mi");
    expect(distances).toContain("1.8 mi");
    expect(distances).toContain("2.1 mi");
    expect(distances).toContain("3.2 mi");

    // Ensure distinct pharmacies have different geographic distances
    const uniqueDistances = new Set(distances);
    expect(uniqueDistances.size).toBeGreaterThan(1);
  });

  it("buildCompareResponse parses string distances ('2.1 mi') to numeric float representations", () => {
    const query = getPharmacyPrices("lisinopril", "90210");
    const response = buildCompareResponse({
      drug: "lisinopril",
      dosage: "10mg",
      zip: "90210",
      usedZipCode: query.usedZipCode,
      isFallbackZip: query.isFallbackZip,
      payTo: "GXXXXXX",
      network: "stellar:testnet",
      prices: query.prices,
    });

    const costco = response.prices.find((p) => p.pharmacyId === "costco-001");
    expect(typeof costco?.distance).toBe("number");
    expect(costco?.distance).toBe(2.1);

    const cvs = response.prices.find((p) => p.pharmacyId === "cvs-001");
    expect(typeof cvs?.distance).toBe("number");
    expect(cvs?.distance).toBe(0.5);
  });

  it("distances are rounded to 1 decimal place in compare responses", () => {
    const response = buildCompareResponse({
      drug: "lisinopril",
      dosage: "10mg",
      zip: "90210",
      payTo: "GXXXXXX",
      network: "stellar:testnet",
      prices: [
        { pharmacy: "Test Pharmacy", id: "test-001", price: 5.0, distanceMiles: 3.456789 },
      ],
    });

    expect(response.prices[0]?.distance).toBe(3.5);
  });

  it("cheapest and mostExpensive summary objects preserve numeric distance", () => {
    const query = getPharmacyPrices("lisinopril", "10001");
    const response = buildCompareResponse({
      drug: "lisinopril",
      dosage: "10mg",
      zip: "10001",
      usedZipCode: query.usedZipCode,
      isFallbackZip: query.isFallbackZip,
      payTo: "GXXXXXX",
      network: "stellar:testnet",
      prices: query.prices,
    });

    expect(typeof response.cheapest.distance).toBe("number");
    expect(response.cheapest.distance).toBeGreaterThan(0);
    expect(typeof response.mostExpensive.distance).toBe("number");
    expect(response.mostExpensive.distance).toBeGreaterThan(0);
  });
});

describe("Zip code parameter validation and fallback routing (#910)", () => {
  it("defaults to DEFAULT_ZIP_CODE (90210) when zip is not provided", () => {
    const result = getPharmacyPrices("lisinopril", undefined);

    expect(result.usedZipCode).toBe(DEFAULT_ZIP_CODE);
    expect(result.usedZipCode).toBe("90210");
    expect(result.isFallbackZip).toBe(true);
    expect(result.prices.length).toBeGreaterThan(0);
  });

  it("accepts supported custom zip codes without triggering fallback", () => {
    const result = getPharmacyPrices("lisinopril", "10001");

    expect(result.usedZipCode).toBe("10001");
    expect(result.isFallbackZip).toBe(false);
  });

  it("falls back to DEFAULT_ZIP_CODE when zip is unsupported, setting isFallbackZip flag", () => {
    const result = getPharmacyPrices("lisinopril", "99999");

    expect(result.usedZipCode).toBe(DEFAULT_ZIP_CODE);
    expect(result.isFallbackZip).toBe(true);
    // Returns default 90210 prices
    expect(result.prices.find((p) => p.id === "costco-001")?.distance).toBe("2.1 mi");
  });

  it("produces valid response conforming to PharmacyCompareResponseSchema", () => {
    const query = getPharmacyPrices("lisinopril", "33101");
    const response = buildCompareResponse({
      drug: "lisinopril",
      dosage: "20mg",
      zip: "33101",
      usedZipCode: query.usedZipCode,
      isFallbackZip: query.isFallbackZip,
      payTo: "GXXXXXX",
      network: "stellar:testnet",
      prices: query.prices,
    });

    const parsed = PharmacyCompareResponseSchema.safeParse(response);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.zipCode).toBe("33101");
      expect(parsed.data.usedZipCode).toBe("33101");
      expect(parsed.data.isFallbackZip).toBe(false);
      expect(parsed.data.prices.every((p) => typeof p.distance === "number")).toBe(true);
    }
  });
});
