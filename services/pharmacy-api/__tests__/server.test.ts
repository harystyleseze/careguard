import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));
vi.mock("../../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.PHARMACY_ADMIN_TOKEN = "admin-secret";

const { createPharmacyPricingStore } = await import("../db.ts");
const { PharmacyCompareQuerySchema } = await import("../logic.ts");
const { createPharmacyApp } = await import("../server.ts");

describe("pharmacy API persistence", () => {
  let tempDir: string;
  let app: ReturnType<typeof createPharmacyApp>["app"];
  let pricingStore: ReturnType<typeof createPharmacyApp>["pricingStore"];

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "careguard-pharmacy-"));
    const store = createPharmacyPricingStore({
      dbPath: path.join(tempDir, "pricing.sqlite"),
    });
    pricingStore = store;
    app = createPharmacyApp({
      payTo: "GBQTESTPHARMACY1",
      adminToken: "admin-secret",
      pricingStore: store,
      enablePayments: false,
    }).app;
  });

  afterEach(() => {
    pricingStore.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("covers seed -> query -> update -> query with persisted prices", async () => {
    const initialQuery = await request(app)
      .get("/pharmacy/compare")
      .query({ drug: "Lisinopril", zip: "90210" });

    expect(initialQuery.status).toBe(200);
    expect(initialQuery.body.cheapest.pharmacyId).toBe("costco-001");
    expect(initialQuery.body.cheapest.price).toBe(3.5);

    const updatePrice = await request(app)
      .post("/pharmacy/prices")
      .set("Authorization", "Bearer admin-secret")
      .send({ drug: "lisinopril", pharmacyId: "cvs-001", price: 1.99 });

    expect(updatePrice.status).toBe(200);
    expect(updatePrice.body.price.price).toBe(1.99);

    const updatedQuery = await request(app)
      .get("/pharmacy/compare")
      .query({ drug: "Lisinopril", zip: "90210" });

    expect(updatedQuery.status).toBe(200);
    expect(updatedQuery.body.cheapest.pharmacyId).toBe("cvs-001");
    expect(updatedQuery.body.cheapest.price).toBe(1.99);
  });

  it("supports CRUD for drugs and pharmacies through admin endpoints", async () => {
    const createDrug = await request(app)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer admin-secret")
      .send({ name: "losartan", displayName: "Losartan", defaultDosage: "50mg" });
    expect(createDrug.status).toBe(201);

    const createPharmacy = await request(app)
      .post("/pharmacy/pharmacies")
      .set("Authorization", "Bearer admin-secret")
      .send({
        id: "independent-001",
        name: "Independent Pharmacy",
        distanceMiles: 1.4,
      });
    expect(createPharmacy.status).toBe(201);

    const setPrice = await request(app)
      .post("/pharmacy/prices")
      .set("Authorization", "Bearer admin-secret")
      .send({ drug: "losartan", pharmacyId: "independent-001", price: 7.25 });
    expect(setPrice.status).toBe(200);

    const compare = await request(app)
      .get("/pharmacy/compare")
      .query({ drug: "losartan", dosage: "50mg", zip: "94105" });
    expect(compare.status).toBe(200);
    expect(compare.body.drug).toBe("Losartan");
    expect(compare.body.cheapest.pharmacyId).toBe("independent-001");

    const deleteDrug = await request(app)
      .delete("/pharmacy/drugs/losartan")
      .set("Authorization", "Bearer admin-secret");
    expect(deleteDrug.status).toBe(204);

    const deletePharmacy = await request(app)
      .delete("/pharmacy/pharmacies/independent-001")
      .set("Authorization", "Bearer admin-secret");
    expect(deletePharmacy.status).toBe(204);
  });

  it("returns 400 for a 100KB drug query string", async () => {
    const schemaResult = PharmacyCompareQuerySchema.safeParse({
      drug: "x".repeat(100_000),
      zip: "90210",
    });

    expect(schemaResult.success).toBe(false);

    const response = await request(app)
      .get("/pharmacy/compare")
      .query({ drug: "x".repeat(81), zip: "90210" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("80 characters");
  });
});
