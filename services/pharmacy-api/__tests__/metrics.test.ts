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
const { createPharmacyApp } = await import("../server.ts");
// Importing the shared module alongside the standalone server must reuse the
// same registry instance rather than re-registering counters.
const metrics = await import("../../../shared/metrics.ts");

describe("pharmacy API standalone /metrics", () => {
  let tempDir: string;
  let app: ReturnType<typeof createPharmacyApp>["app"];
  let pricingStore: ReturnType<typeof createPharmacyApp>["pricingStore"];
  const savedToken = process.env.METRICS_TOKEN;

  beforeEach(() => {
    delete process.env.METRICS_TOKEN;
    tempDir = mkdtempSync(path.join(tmpdir(), "careguard-pharmacy-metrics-"));
    pricingStore = createPharmacyPricingStore({
      dbPath: path.join(tempDir, "pricing.sqlite"),
    });
    app = createPharmacyApp({
      payTo: "GBQTESTPHARMACY1",
      adminToken: "admin-secret",
      pricingStore,
      enablePayments: false,
    }).app;
  });

  afterEach(() => {
    pricingStore.close();
    rmSync(tempDir, { recursive: true, force: true });
    if (savedToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = savedToken;
  });

  it("exposes pharmacy_unknown_drug_total after an unknown-drug query", async () => {
    const miss = await request(app)
      .get("/pharmacy/compare")
      .query({ drug: "notarealdrug", zip: "90210" });
    expect(miss.status).toBe(404);

    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("pharmacy_unknown_drug_total");
    expect(res.text).toMatch(/pharmacy_unknown_drug_total\{drug="notarealdrug"\} [1-9]/);
  });

  it("requires the METRICS_TOKEN bearer when it is set", async () => {
    process.env.METRICS_TOKEN = "metrics-secret";

    const unauthorized = await request(app).get("/metrics");
    expect(unauthorized.status).toBe(401);

    const wrong = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer nope");
    expect(wrong.status).toBe(401);

    const ok = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer metrics-secret");
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("pharmacy_unknown_drug_total");
  });

  it("shares a single counter registration with the shared registry", async () => {
    expect(metrics.registry.getSingleMetric("pharmacy_unknown_drug_total")).toBe(
      metrics.pharmacyUnknownDrugTotal,
    );
    // A second app instance must not trigger duplicate-registration errors.
    expect(() =>
      createPharmacyApp({
        payTo: "GBQTESTPHARMACY1",
        pricingStore,
        enablePayments: false,
      }),
    ).not.toThrow();
  });
});
