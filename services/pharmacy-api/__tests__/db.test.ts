import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPharmacyPricingStore } from "../db.ts";

const stores: ReturnType<typeof createPharmacyPricingStore>[] = [];

function makeStore() {
  const store = createPharmacyPricingStore({
    dbPath: ":memory:",
    seedData: { pharmacies: [], drugs: [], prices: [] },
  });
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe("PharmacyPricingStore", () => {
  it("adds a price using foreign keys and returns the joined record", () => {
    const store = makeStore();
    store.upsertDrug({ name: "Metformin" });
    store.upsertPharmacy({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });

    expect(store.upsertPrice({
      drug: "METFORMIN",
      pharmacyId: "CVS-001",
      price: 12.49,
    })).toMatchObject({
      drug: "metformin",
      pharmacyId: "cvs-001",
      pharmacy: "CVS",
      price: 12.49,
    });
  });

  it("translates foreign-key failures to the existing missing-drug message", () => {
    const store = makeStore();
    store.upsertPharmacy({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });

    expect(() => store.upsertPrice({
      drug: "unknown-drug",
      pharmacyId: "cvs-001",
      price: 12.49,
    })).toThrow("Drug not found: unknown-drug");
  });

  it("translates foreign-key failures to the existing missing-pharmacy message", () => {
    const store = makeStore();
    store.upsertDrug({ name: "metformin" });

    expect(() => store.upsertPrice({
      drug: "metformin",
      pharmacyId: "unknown-pharmacy",
      price: 12.49,
    })).toThrow("Pharmacy not found: unknown-pharmacy");
  });

  it("reports a contextual error when the database parent path is a file", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pharmacy-db-test-"));
    const parentFile = path.join(directory, "not-a-directory");
    const dbPath = path.join(parentFile, "pharmacy.sqlite");
    writeFileSync(parentFile, "not a directory");

    try {
      expect(() => createPharmacyPricingStore({
        dbPath,
        seedData: { pharmacies: [], drugs: [], prices: [] },
      })).toThrow(`Unable to initialize pharmacy pricing database at ${dbPath}:`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("queries price records from the SQLite store", () => {
    const store = makeStore();
    store.upsertDrug({ name: "metformin", displayName: "Metformin" });
    store.upsertPharmacy({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    store.upsertPrice({ drug: "metformin", pharmacyId: "cvs-001", price: 12.49 });

    expect(store.getPrices("METFORMIN")).toEqual([{
      drug: "metformin",
      displayName: "Metformin",
      pharmacyId: "cvs-001",
      pharmacy: "CVS",
      price: 12.49,
      distanceMiles: 0.5,
    }]);
  });
});
