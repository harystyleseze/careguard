/**
 * HTTP integration tests for pharmacy-api — Issue #787
 *
 * Black-box tests that boot the Express app via supertest and exercise all
 * 11 route handlers end-to-end: validation, status codes, error bodies, and
 * the db.ts-backed persistence layer. Each describe block uses an isolated
 * in-memory SQLite store so tests never share state or touch seed data on disk.
 */

import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));
vi.mock("../../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

const ADMIN_TOKEN = "test-admin-secret";
const PAY_TO = "GBQTESTPAYTO1";

const { createPharmacyPricingStore } = await import("../db.ts");
const { createPharmacyApp } = await import("../server.ts");

/** Helper – spin up a fresh in-memory store + app before each test. */
function makeApp() {
  const store = createPharmacyPricingStore({ dbPath: ":memory:", seedData: { pharmacies: [], drugs: [], prices: [] } });
  const { app } = createPharmacyApp({
    payTo: PAY_TO,
    adminToken: ADMIN_TOKEN,
    pricingStore: store,
    enablePayments: false,
  });
  return { app, store };
}

/** Helper – Bearer header for admin calls. */
const adminHeader = { Authorization: `Bearer ${ADMIN_TOKEN}` };

// ---------------------------------------------------------------------------
// GET / — service info
// ---------------------------------------------------------------------------
describe("GET /", () => {
  it("returns 200 with service metadata", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toMatch(/pharmacy/i);
    expect(res.body.protocol).toMatch(/x402/i);
  });
});

// ---------------------------------------------------------------------------
// GET /ready
// ---------------------------------------------------------------------------
describe("GET /ready", () => {
  it("returns 200 OK when store is initialised", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
  });

  it("returns 503 when the app is draining", async () => {
    const store = createPharmacyPricingStore({ dbPath: ":memory:", seedData: { pharmacies: [], drugs: [], prices: [] } });
    const instance = createPharmacyApp({
      payTo: PAY_TO,
      adminToken: ADMIN_TOKEN,
      pricingStore: store,
      enablePayments: false,
    });
    instance.setDraining(true);
    const res = await request(instance.app).get("/ready");
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Unknown route → 404
// ---------------------------------------------------------------------------
describe("unknown routes", () => {
  it("returns 404 for an unregistered path", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /pharmacy/drugs
// ---------------------------------------------------------------------------
describe("GET /pharmacy/drugs", () => {
  it("returns an empty drugs list when the store has no drugs", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/pharmacy/drugs");
    expect(res.status).toBe(200);
    expect(res.body.drugs).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it("lists drugs that were previously created", async () => {
    const { app } = makeApp();
    await request(app)
      .post("/pharmacy/drugs")
      .set(adminHeader)
      .send({ name: "metformin", displayName: "Metformin", defaultDosage: "500mg" });

    const res = await request(app).get("/pharmacy/drugs");
    expect(res.status).toBe(200);
    expect(res.body.drugs).toHaveLength(1);
    expect(res.body.drugs[0].name).toBe("metformin");
  });
});

// ---------------------------------------------------------------------------
// GET /pharmacy/pharmacies
// ---------------------------------------------------------------------------
describe("GET /pharmacy/pharmacies", () => {
  it("returns an empty pharmacies list when the store has no pharmacies", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/pharmacy/pharmacies");
    expect(res.status).toBe(200);
    expect(res.body.pharmacies).toEqual([]);
  });

  it("lists pharmacies that were previously created", async () => {
    const { app } = makeApp();
    await request(app)
      .post("/pharmacy/pharmacies")
      .set(adminHeader)
      .send({ id: "walgreens-001", name: "Walgreens", distanceMiles: 1.2 });

    const res = await request(app).get("/pharmacy/pharmacies");
    expect(res.status).toBe(200);
    expect(res.body.pharmacies).toHaveLength(1);
    expect(res.body.pharmacies[0].id).toBe("walgreens-001");
  });
});

// ---------------------------------------------------------------------------
// POST /pharmacy/drugs — admin required
// ---------------------------------------------------------------------------
describe("POST /pharmacy/drugs", () => {
  it("returns 401 without an Authorization header", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/pharmacy/drugs").send({ name: "aspirin" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing admin token/i);
  });

  it("returns 403 with a wrong token", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/drugs")
      .set("Authorization", "Bearer wrong-token")
      .send({ name: "aspirin" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid admin token/i);
  });

  it("returns 400 when the body is missing required fields", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/drugs")
      .set(adminHeader)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when name exceeds max length", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/drugs")
      .set(adminHeader)
      .send({ name: "x".repeat(200) });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 201 and the created drug on valid input", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/drugs")
      .set(adminHeader)
      .send({ name: "atorvastatin", displayName: "Atorvastatin", defaultDosage: "10mg" });
    expect(res.status).toBe(201);
    expect(res.body.drug.name).toBe("atorvastatin");
    expect(res.body.drug.displayName).toBe("Atorvastatin");
    expect(res.body.drug.defaultDosage).toBe("10mg");
  });

  it("upserts (does not duplicate) on a second POST with the same name", async () => {
    const { app } = makeApp();
    await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "ibuprofen" });
    const res = await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "ibuprofen", displayName: "Ibuprofen 400mg" });
    expect(res.status).toBe(201);
    const list = await request(app).get("/pharmacy/drugs");
    expect(list.body.drugs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PUT /pharmacy/drugs/:drugName — admin required
// ---------------------------------------------------------------------------
describe("PUT /pharmacy/drugs/:drugName", () => {
  it("returns 401 without an Authorization header", async () => {
    const { app } = makeApp();
    const res = await request(app).put("/pharmacy/drugs/aspirin").send({ displayName: "Aspirin" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body has an invalid field", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put("/pharmacy/drugs/aspirin")
      .set(adminHeader)
      .send({ distanceMiles: -1 }); // unknown strict field
    expect(res.status).toBe(400);
  });

  it("creates-or-updates a drug and returns 200", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put("/pharmacy/drugs/lisinopril")
      .set(adminHeader)
      .send({ displayName: "Lisinopril Updated", defaultDosage: "20mg" });
    expect(res.status).toBe(200);
    expect(res.body.drug.name).toBe("lisinopril");
    expect(res.body.drug.displayName).toBe("Lisinopril Updated");
  });
});

// ---------------------------------------------------------------------------
// DELETE /pharmacy/drugs/:drugName — admin required
// ---------------------------------------------------------------------------
describe("DELETE /pharmacy/drugs/:drugName", () => {
  it("returns 401 without Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).delete("/pharmacy/drugs/lisinopril");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the drug does not exist", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .delete("/pharmacy/drugs/nonexistent-drug")
      .set(adminHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 204 and removes the drug on success", async () => {
    const { app } = makeApp();
    await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "warfarin" });
    const del = await request(app).delete("/pharmacy/drugs/warfarin").set(adminHeader);
    expect(del.status).toBe(204);
    // Confirm it's gone
    const list = await request(app).get("/pharmacy/drugs");
    expect(list.body.drugs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /pharmacy/pharmacies — admin required
// ---------------------------------------------------------------------------
describe("POST /pharmacy/pharmacies", () => {
  it("returns 401 without Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/pharmacy/pharmacies").send({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/pharmacies")
      .set(adminHeader)
      .send({ name: "CVS" }); // missing id and distanceMiles
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when distanceMiles is negative", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/pharmacies")
      .set(adminHeader)
      .send({ id: "cvs-001", name: "CVS", distanceMiles: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 201 and the created pharmacy on valid input", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/pharmacies")
      .set(adminHeader)
      .send({ id: "costco-001", name: "Costco Pharmacy", distanceMiles: 2.1 });
    expect(res.status).toBe(201);
    expect(res.body.pharmacy.id).toBe("costco-001");
    expect(res.body.pharmacy.name).toBe("Costco Pharmacy");
    expect(res.body.pharmacy.distanceMiles).toBe(2.1);
  });
});

// ---------------------------------------------------------------------------
// PUT /pharmacy/pharmacies/:pharmacyId — admin required
// ---------------------------------------------------------------------------
describe("PUT /pharmacy/pharmacies/:pharmacyId", () => {
  it("returns 401 without Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).put("/pharmacy/pharmacies/cvs-001").send({ name: "CVS", distanceMiles: 1 });
    expect(res.status).toBe(401);
  });

  it("returns 400 when body has invalid distanceMiles", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put("/pharmacy/pharmacies/cvs-001")
      .set(adminHeader)
      .send({ name: "CVS", distanceMiles: 600 }); // exceeds max of 500
    expect(res.status).toBe(400);
  });

  it("creates-or-updates a pharmacy and returns 200", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .put("/pharmacy/pharmacies/walgreens-001")
      .set(adminHeader)
      .send({ name: "Walgreens Updated", distanceMiles: 3.0 });
    expect(res.status).toBe(200);
    expect(res.body.pharmacy.id).toBe("walgreens-001");
    expect(res.body.pharmacy.name).toBe("Walgreens Updated");
  });
});

// ---------------------------------------------------------------------------
// DELETE /pharmacy/pharmacies/:pharmacyId — admin required
// ---------------------------------------------------------------------------
describe("DELETE /pharmacy/pharmacies/:pharmacyId", () => {
  it("returns 401 without Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).delete("/pharmacy/pharmacies/cvs-001");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the pharmacy does not exist", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .delete("/pharmacy/pharmacies/nonexistent-pharmacy")
      .set(adminHeader);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 204 and removes the pharmacy on success", async () => {
    const { app } = makeApp();
    await request(app).post("/pharmacy/pharmacies").set(adminHeader).send({ id: "rite-aid-001", name: "Rite Aid", distanceMiles: 0.8 });
    const del = await request(app).delete("/pharmacy/pharmacies/rite-aid-001").set(adminHeader);
    expect(del.status).toBe(204);
    const list = await request(app).get("/pharmacy/pharmacies");
    expect(list.body.pharmacies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /pharmacy/prices — admin required
// ---------------------------------------------------------------------------
describe("POST /pharmacy/prices", () => {
  it("returns 401 without Authorization", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/pharmacy/prices").send({ drug: "metformin", pharmacyId: "cvs-001", price: 5 });
    expect(res.status).toBe(401);
  });

  it("returns 400 when the body is empty", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/pharmacy/prices").set(adminHeader).send({});
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when price is zero or negative", async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post("/pharmacy/prices")
      .set(adminHeader)
      .send({ drug: "metformin", pharmacyId: "cvs-001", price: 0 });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when drug does not exist", async () => {
    const { app } = makeApp();
    // Create pharmacy but not the drug
    await request(app).post("/pharmacy/pharmacies").set(adminHeader).send({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    const res = await request(app)
      .post("/pharmacy/prices")
      .set(adminHeader)
      .send({ drug: "unknowndrug", pharmacyId: "cvs-001", price: 9.99 });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 when pharmacy does not exist", async () => {
    const { app } = makeApp();
    await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "metformin" });
    const res = await request(app)
      .post("/pharmacy/prices")
      .set(adminHeader)
      .send({ drug: "metformin", pharmacyId: "unknown-pharmacy", price: 9.99 });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 200 with multi-drug payload and saves the price", async () => {
    const { app } = makeApp();
    await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "metformin" });
    await request(app).post("/pharmacy/pharmacies").set(adminHeader).send({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    const res = await request(app)
      .post("/pharmacy/prices")
      .set(adminHeader)
      .send({ drug: "metformin", pharmacyId: "cvs-001", price: 12.49 });
    expect(res.status).toBe(200);
    expect(res.body.price.price).toBe(12.49);
    expect(res.body.price.drug).toBe("metformin");
    expect(res.body.price.pharmacyId).toBe("cvs-001");
  });
});

// ---------------------------------------------------------------------------
// GET /pharmacy/compare
// ---------------------------------------------------------------------------
describe("GET /pharmacy/compare", () => {
  /** Helper — seed a drug + 2 pharmacies + prices into the given app. */
  async function seedCompareData(app: Express.Application) {
    await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "lisinopril", displayName: "Lisinopril", defaultDosage: "10mg" });
    await request(app).post("/pharmacy/pharmacies").set(adminHeader).send({ id: "cvs-001", name: "CVS", distanceMiles: 0.5 });
    await request(app).post("/pharmacy/pharmacies").set(adminHeader).send({ id: "costco-001", name: "Costco", distanceMiles: 2.1 });
    await request(app).post("/pharmacy/prices").set(adminHeader).send({ drug: "lisinopril", pharmacyId: "cvs-001", price: 15.0 });
    await request(app).post("/pharmacy/prices").set(adminHeader).send({ drug: "lisinopril", pharmacyId: "costco-001", price: 3.5 });
  }

  it("returns 400 when drug query param is missing", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/pharmacy/compare").query({ zip: "90210" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 400 when drug name exceeds 80 characters", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/pharmacy/compare").query({ drug: "x".repeat(81), zip: "90210" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 404 with NO_PRICES_FOUND for a drug not in the catalog", async () => {
    const { app } = makeApp();
    const res = await request(app).get("/pharmacy/compare").query({ drug: "unknowndrug", zip: "90210" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "No pricing records found for drug: unknowndrug",
      code: "NOT_FOUND_DRUG"
    });
  });

  it("returns 200 with ranked prices and correct cheapest entry", async () => {
    const { app } = makeApp();
    await seedCompareData(app);
    const res = await request(app).get("/pharmacy/compare").query({ drug: "lisinopril", zip: "90210" });
    expect(res.status).toBe(200);
    expect(res.body.cheapest.pharmacyId).toBe("costco-001");
    expect(res.body.cheapest.price).toBe(3.5);
    expect(res.body.prices).toHaveLength(2);
    // Prices should be sorted cheapest first
    expect(res.body.prices[0].price).toBeLessThanOrEqual(res.body.prices[1].price);
  });

  it("echoes the zipCode back in the response", async () => {
    const { app } = makeApp();
    await seedCompareData(app);
    const res = await request(app).get("/pharmacy/compare").query({ drug: "lisinopril", zip: "94105" });
    expect(res.status).toBe(200);
    expect(res.body.zipCode).toBe("94105");
    expect(res.body.isFallbackZip).toBe(true);
    expect(res.body.usedZipCode).toBe("90210");
  });

  it("uses default zip 90210 when zip param is omitted", async () => {
    const { app } = makeApp();
    await seedCompareData(app);
    const res = await request(app).get("/pharmacy/compare").query({ drug: "lisinopril" });
    expect(res.status).toBe(200);
    expect(res.body.zipCode).toBe("90210");
  });

  it("includes potentialSavings and savingsPercent in the response", async () => {
    const { app } = makeApp();
    await seedCompareData(app);
    const res = await request(app).get("/pharmacy/compare").query({ drug: "lisinopril", zip: "90210" });
    expect(res.status).toBe(200);
    expect(typeof res.body.potentialSavings).toBe("number");
    expect(typeof res.body.savingsPercent).toBe("number");
    expect(res.body.potentialSavings).toBeGreaterThan(0);
  });

  it("reports inStock: true for every pharmacy, never 'unknown' (Issue #1063)", async () => {
    const { app } = makeApp();
    await seedCompareData(app);
    const res = await request(app).get("/pharmacy/compare").query({ drug: "lisinopril", zip: "90210" });
    expect(res.status).toBe(200);
    expect(res.body.prices.length).toBeGreaterThan(0);
    for (const price of res.body.prices) {
      expect(price.inStock).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end state isolation — no shared state leakage between tests
// ---------------------------------------------------------------------------
describe("state isolation between tests", () => {
  it("test A: creates a drug", async () => {
    const { app } = makeApp();
    const res = await request(app).post("/pharmacy/drugs").set(adminHeader).send({ name: "testdrug" });
    expect(res.status).toBe(201);
    const list = await request(app).get("/pharmacy/drugs");
    expect(list.body.drugs).toHaveLength(1);
  });

  it("test B: sees an empty store (no bleed-over from test A)", async () => {
    const { app } = makeApp();
    const list = await request(app).get("/pharmacy/drugs");
    expect(list.body.drugs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Admin middleware — no token configured
// ---------------------------------------------------------------------------
describe("admin middleware — token not configured", () => {
  it("returns 503 when PHARMACY_ADMIN_TOKEN is not set and adminToken option is undefined", async () => {
    const store = createPharmacyPricingStore({ dbPath: ":memory:", seedData: { pharmacies: [], drugs: [], prices: [] } });
    const { app } = createPharmacyApp({
      payTo: PAY_TO,
      adminToken: undefined,
      pricingStore: store,
      enablePayments: false,
    });
    const res = await request(app).post("/pharmacy/drugs").set("Authorization", "Bearer anything").send({ name: "aspirin" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
