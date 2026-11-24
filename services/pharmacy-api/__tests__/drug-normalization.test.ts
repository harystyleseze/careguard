import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeDrugName, PharmacyPricingStore } from "../db.ts";
import {
  getPharmacyPrices,
  PRICING_DATABASE,
} from "../../../shared/pharmacy-pricing.ts";

describe("Drug Name Normalization & Case-Insensitive Lookup (#911)", () => {
  describe("normalizeDrugName unit function (from db.ts)", () => {
    it("converts uppercase, title-case, and mixed-case drug names to lowercase", () => {
      expect(normalizeDrugName("LISINOPRIL")).toBe("lisinopril");
      expect(normalizeDrugName("Lisinopril")).toBe("lisinopril");
      expect(normalizeDrugName("lIsInOpRiL")).toBe("lisinopril");
      expect(normalizeDrugName("LisinoPril")).toBe("lisinopril");
      expect(normalizeDrugName("lisinopril")).toBe("lisinopril");
    });

    it("trims leading and trailing whitespace while lowercasing", () => {
      expect(normalizeDrugName("   atorvastatin   ")).toBe("atorvastatin");
      expect(normalizeDrugName("\tMetformin\n")).toBe("metformin");
    });

    it("is idempotent — applying normalization repeatedly yields identical output", () => {
      const rawNames = ["Lisinopril", "METFORMIN", "Atorvastatin", "  amlodipine  "];
      for (const name of rawNames) {
        const once = normalizeDrugName(name);
        const twice = normalizeDrugName(once);
        expect(twice).toBe(once);
      }
    });

    it("ensures all real catalog keys in PRICING_DATABASE match normalized output", () => {
      const catalogKeys = Object.keys(PRICING_DATABASE);
      expect(catalogKeys.length).toBeGreaterThan(0);
      for (const key of catalogKeys) {
        expect(key).toBe(normalizeDrugName(key));
      }
    });
  });

  describe("getPharmacyPrices() case-insensitive lookups (from shared/pharmacy-pricing.ts)", () => {
    it("lookup succeeds for title-case input (Lisinopril)", () => {
      const result = getPharmacyPrices("Lisinopril");
      expect(result.prices.length).toBeGreaterThan(0);
      expect(result.usedZipCode).toBe("90210");
    });

    it("lookup succeeds for all-caps input (LISINOPRIL)", () => {
      const result = getPharmacyPrices("LISINOPRIL");
      expect(result.prices.length).toBeGreaterThan(0);
    });

    it("lookup succeeds for mixed-case input (lIsInOpRiL)", () => {
      const result = getPharmacyPrices("lIsInOpRiL");
      expect(result.prices.length).toBeGreaterThan(0);
    });

    it("lookup succeeds for camel-case input (LisinoPril)", () => {
      const result = getPharmacyPrices("LisinoPril");
      expect(result.prices.length).toBeGreaterThan(0);
    });

    it("lookup succeeds for already-lowercase input (lisinopril)", () => {
      const result = getPharmacyPrices("lisinopril");
      expect(result.prices.length).toBeGreaterThan(0);
    });

    it("lookup succeeds for whitespace-padded input (  lisinopril  )", () => {
      const result = getPharmacyPrices("  lisinopril  ");
      expect(result.prices.length).toBeGreaterThan(0);
    });

    it("returns identical price lists regardless of casing input", () => {
      const lower = getPharmacyPrices("lisinopril");
      const title = getPharmacyPrices("Lisinopril");
      const upper = getPharmacyPrices("LISINOPRIL");
      const mixed = getPharmacyPrices("lIsInOpRiL");

      expect(title.prices).toEqual(lower.prices);
      expect(upper.prices).toEqual(lower.prices);
      expect(mixed.prices).toEqual(lower.prices);
    });

    it("throws a clear error for an unlisted drug", () => {
      expect(() => getPharmacyPrices("NonExistentMedicine")).toThrow(
        "Drug not found: NonExistentMedicine",
      );
    });
  });

  describe("PharmacyPricingStore.getPrices() case-insensitivity on SQLite store", () => {
    let store: PharmacyPricingStore;

    beforeEach(() => {
      store = new PharmacyPricingStore({
        dbPath: ":memory:",
        seedData: {
          drugs: [
            { name: "lisinopril", displayName: "Lisinopril", defaultDosage: "10mg" },
          ],
          pharmacies: [
            { id: "costco-001", name: "Costco Pharmacy", distanceMiles: 2.1 },
          ],
          prices: [
            { drug: "lisinopril", pharmacyId: "costco-001", price: 3.5 },
          ],
        },
      });
    });

    afterEach(() => {
      store.close();
    });

    it("queries prices across various casing permutations on the SQLite store", () => {
      const expected = store.getPrices("lisinopril");
      expect(store.getPrices("Lisinopril")).toEqual(expected);
      expect(store.getPrices("LISINOPRIL")).toEqual(expected);
      expect(store.getPrices("lIsInOpRiL")).toEqual(expected);
    });
  });
});
