import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  PharmacyPricingStore,
  normalizeDrugName,
  normalizePharmacyId,
  toDisplayName,
} from "../db.ts";

describe("PharmacyPricingStore Unit Tests & ON DELETE CASCADE (#909)", () => {
  let store: PharmacyPricingStore;

  beforeEach(() => {
    store = new PharmacyPricingStore({
      dbPath: ":memory:",
      seedData: { drugs: [], pharmacies: [], prices: [] },
    });
  });

  afterEach(() => {
    store.close();
  });

  describe("Lifecycle & Seeding", () => {
    it("initializes an empty in-memory store without error", () => {
      expect(store.getDrugCount()).toBe(0);
      expect(store.listDrugs()).toEqual([]);
      expect(store.listPharmacies()).toEqual([]);
    });

    it("seeds initial data when non-empty seedData is provided", () => {
      const seededStore = new PharmacyPricingStore({
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

      expect(seededStore.getDrugCount()).toBe(1);
      expect(seededStore.listDrugs()[0]?.name).toBe("lisinopril");
      expect(seededStore.listPharmacies()[0]?.id).toBe("costco-001");
      const prices = seededStore.getPrices("lisinopril");
      expect(prices).toHaveLength(1);
      expect(prices[0]?.price).toBe(3.5);
      seededStore.close();
    });
  });

  describe("Drug Management (upsertDrug, deleteDrug, listDrugs)", () => {
    it("upserts a new drug and normalizes name to lowercase", () => {
      const result = store.upsertDrug({
        name: "  Atorvastatin  ",
        displayName: "Atorvastatin Calcium",
        defaultDosage: "20mg",
      });

      expect(result.name).toBe("atorvastatin");
      expect(result.displayName).toBe("Atorvastatin Calcium");
      expect(result.defaultDosage).toBe("20mg");
      expect(store.getDrugCount()).toBe(1);

      const drugs = store.listDrugs();
      expect(drugs).toHaveLength(1);
      expect(drugs[0]?.name).toBe("atorvastatin");
      expect(drugs[0]?.displayName).toBe("Atorvastatin Calcium");
    });

    it("generates fallback displayName via toDisplayName when omitted", () => {
      const result = store.upsertDrug({
        name: "metformin",
      });

      expect(result.displayName).toBe(toDisplayName("metformin"));
      expect(result.defaultDosage).toBeNull();
    });

    it("updates existing drug record on name conflict without duplicating", () => {
      store.upsertDrug({
        name: "amlodipine",
        displayName: "Amlodipine Besylate",
        defaultDosage: "5mg",
      });

      const updated = store.upsertDrug({
        name: "amlodipine",
        displayName: "Amlodipine Updated",
        defaultDosage: "10mg",
      });

      expect(updated.displayName).toBe("Amlodipine Updated");
      expect(updated.defaultDosage).toBe("10mg");
      expect(store.getDrugCount()).toBe(1);

      const drugs = store.listDrugs();
      expect(drugs).toHaveLength(1);
      expect(drugs[0]?.displayName).toBe("Amlodipine Updated");
    });

    it("deletes an existing drug and returns true", () => {
      store.upsertDrug({ name: "omeprazole" });
      expect(store.getDrugCount()).toBe(1);

      const deleted = store.deleteDrug("Omeprazole");
      expect(deleted).toBe(true);
      expect(store.getDrugCount()).toBe(0);
      expect(store.listDrugs()).toEqual([]);
    });

    it("returns false when attempting to delete a non-existent drug", () => {
      const deleted = store.deleteDrug("non-existent-drug");
      expect(deleted).toBe(false);
    });
  });

  describe("Pharmacy Management (upsertPharmacy, deletePharmacy, listPharmacies)", () => {
    it("upserts a new pharmacy and normalizes id to lowercase", () => {
      const pharmacy = store.upsertPharmacy({
        id: "  CVS-001  ",
        name: "CVS Pharmacy",
        distanceMiles: 1.2,
      });

      expect(pharmacy.id).toBe("cvs-001");
      expect(pharmacy.name).toBe("CVS Pharmacy");
      expect(pharmacy.distanceMiles).toBe(1.2);

      const pharmacies = store.listPharmacies();
      expect(pharmacies).toHaveLength(1);
      expect(pharmacies[0]?.id).toBe("cvs-001");
    });

    it("updates existing pharmacy record on id conflict", () => {
      store.upsertPharmacy({
        id: "walgreens-001",
        name: "Walgreens",
        distanceMiles: 2.0,
      });

      const updated = store.upsertPharmacy({
        id: "walgreens-001",
        name: "Walgreens Pharmacy",
        distanceMiles: 2.5,
      });

      expect(updated.name).toBe("Walgreens Pharmacy");
      expect(updated.distanceMiles).toBe(2.5);

      const pharmacies = store.listPharmacies();
      expect(pharmacies).toHaveLength(1);
      expect(pharmacies[0]?.name).toBe("Walgreens Pharmacy");
    });

    it("deletes an existing pharmacy and returns true", () => {
      store.upsertPharmacy({
        id: "riteaid-001",
        name: "Rite Aid",
        distanceMiles: 3.0,
      });

      const deleted = store.deletePharmacy("RITEAID-001");
      expect(deleted).toBe(true);
      expect(store.listPharmacies()).toEqual([]);
    });

    it("returns false when deleting non-existent pharmacy", () => {
      const deleted = store.deletePharmacy("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("Pricing Operations (upsertPrice, getPrices)", () => {
    beforeEach(() => {
      store.upsertDrug({ name: "lisinopril", displayName: "Lisinopril" });
      store.upsertPharmacy({ id: "costco-001", name: "Costco", distanceMiles: 2.1 });
      store.upsertPharmacy({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    });

    it("throws error when inserting price for non-existent drug", () => {
      expect(() => {
        store.upsertPrice({
          drug: "unknown-drug",
          pharmacyId: "costco-001",
          price: 5.0,
        });
      }).toThrow(/Drug not found: unknown-drug/);
    });

    it("throws error when inserting price for non-existent pharmacy", () => {
      expect(() => {
        store.upsertPrice({
          drug: "lisinopril",
          pharmacyId: "unknown-pharmacy",
          price: 5.0,
        });
      }).toThrow(/Pharmacy not found: unknown-pharmacy/);
    });

    it("upserts price and updates price on conflict", () => {
      const p1 = store.upsertPrice({
        drug: "lisinopril",
        pharmacyId: "costco-001",
        price: 3.5,
      });
      expect(p1.price).toBe(3.5);

      const p2 = store.upsertPrice({
        drug: "lisinopril",
        pharmacyId: "costco-001",
        price: 3.25,
      });
      expect(p2.price).toBe(3.25);

      const prices = store.getPrices("lisinopril");
      expect(prices).toHaveLength(1);
      expect(prices[0]?.price).toBe(3.25);
    });

    it("retrieves prices sorted by price ASC, then pharmacy name ASC", () => {
      store.upsertPrice({ drug: "lisinopril", pharmacyId: "cvs-001", price: 12.99 });
      store.upsertPrice({ drug: "lisinopril", pharmacyId: "costco-001", price: 3.5 });

      const prices = store.getPrices("lisinopril");
      expect(prices).toHaveLength(2);
      expect(prices[0]?.pharmacyId).toBe("costco-001");
      expect(prices[0]?.price).toBe(3.5);
      expect(prices[1]?.pharmacyId).toBe("cvs-001");
      expect(prices[1]?.price).toBe(12.99);
    });

    it("getPrices throws error when no prices exist for drug", () => {
      store.upsertDrug({ name: "unpriced-drug" });
      expect(() => {
        store.getPrices("unpriced-drug");
      }).toThrow(/Drug not found: unpriced-drug/);
    });
  });

  describe("ON DELETE CASCADE Verification at Store Level (#909)", () => {
    beforeEach(() => {
      store.upsertDrug({ name: "metformin", displayName: "Metformin" });
      store.upsertPharmacy({ id: "costco-001", name: "Costco", distanceMiles: 2.1 });
      store.upsertPharmacy({ id: "walmart-001", name: "Walmart", distanceMiles: 1.8 });

      store.upsertPrice({ drug: "metformin", pharmacyId: "costco-001", price: 4.0 });
      store.upsertPrice({ drug: "metformin", pharmacyId: "walmart-001", price: 4.5 });
    });

    it("cascades deletion of a drug to remove all its dependent prices", () => {
      expect(store.getPrices("metformin")).toHaveLength(2);

      // Verify rows exist in prices table before deletion
      const rawDb = (store as any).db;
      const countBefore = rawDb
        .prepare("SELECT COUNT(*) AS count FROM prices WHERE drug_name = ?")
        .get("metformin") as { count: number };
      expect(Number(countBefore.count)).toBe(2);

      // Delete the drug
      const deleted = store.deleteDrug("metformin");
      expect(deleted).toBe(true);

      // Verify that ON DELETE CASCADE purged all price records
      const countAfter = rawDb
        .prepare("SELECT COUNT(*) AS count FROM prices WHERE drug_name = ?")
        .get("metformin") as { count: number };
      expect(Number(countAfter.count)).toBe(0);

      // getPrices should throw because drug/prices are gone
      expect(() => store.getPrices("metformin")).toThrow(/Drug not found: metformin/);

      // Ensure pharmacies still exist independently
      expect(store.listPharmacies()).toHaveLength(2);
    });

    it("cascades deletion of a pharmacy to remove only its dependent prices", () => {
      expect(store.getPrices("metformin")).toHaveLength(2);

      const rawDb = (store as any).db;

      // Delete costco-001
      const deleted = store.deletePharmacy("costco-001");
      expect(deleted).toBe(true);

      // Verify costco price is removed from prices table by foreign key cascade
      const costcoPriceCount = rawDb
        .prepare("SELECT COUNT(*) AS count FROM prices WHERE pharmacy_id = ?")
        .get("costco-001") as { count: number };
      expect(Number(costcoPriceCount.count)).toBe(0);

      // Walmart price should still remain
      const remainingPrices = store.getPrices("metformin");
      expect(remainingPrices).toHaveLength(1);
      expect(remainingPrices[0]?.pharmacyId).toBe("walmart-001");
      expect(remainingPrices[0]?.price).toBe(4.5);

      // Delete walmart-001
      store.deletePharmacy("walmart-001");
      const walmartPriceCount = rawDb
        .prepare("SELECT COUNT(*) AS count FROM prices WHERE pharmacy_id = ?")
        .get("walmart-001") as { count: number };
      expect(Number(walmartPriceCount.count)).toBe(0);

      // Now all prices for metformin are cascaded away
      expect(() => store.getPrices("metformin")).toThrow(/Drug not found: metformin/);
      // Drug itself still exists
      expect(store.getDrugCount()).toBe(1);
    });
  });
});
