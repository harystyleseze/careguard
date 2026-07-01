import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

// Mock Keypair.fromSecret to prevent invalid checksum errors with dummy secret keys
vi.spyOn(Keypair, "fromSecret").mockImplementation(() => {
  return {
    publicKey: () => "GBQTESTPHARMACY1",
    secret: () => "mock-secret",
  } as any;
});

vi.mock("../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));


// Mock env vars before importing server.ts to satisfy z.object schema validation
process.env.LLM_API_KEY = "mock-key";
process.env.AGENT_SECRET_KEY = "S-mock-secret";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTPHARMACY2";
process.env.MPP_SECRET_KEY = "S-mock-secret";
process.env.CAREGIVER_TOKEN = "mock-token";






// Dynamic imports to ensure env vars are set first
const { app: unifiedApp } = await import("../server.ts");
const { createPharmacyApp } = await import("../services/pharmacy-api/server.ts");


describe("Pharmacy Server Modes Comparison", () => {
  let standaloneApp: any;

  beforeEach(() => {
    standaloneApp = createPharmacyApp({
      payTo: "GBQTESTPHARMACY1",
      enablePayments: false,
    }).app;
  });

  it("asserts both server modes return identical response shapes and data for lisinopril", async () => {
    // 1. Query unified server
    const unifiedRes = await request(unifiedApp)
      .get("/pharmacy/compare")
      .query({ drug: "Lisinopril", zip: "90210" });

    // 2. Query standalone server
    const standaloneRes = await request(standaloneApp)
      .get("/pharmacy/compare")
      .query({ drug: "Lisinopril", zip: "90210" });

    expect(unifiedRes.status).toBe(200);
    expect(standaloneRes.status).toBe(200);



    // Assert identical shapes and data
    expect(unifiedRes.body.drug).toBe(standaloneRes.body.drug);
    expect(unifiedRes.body.dosage).toBe(standaloneRes.body.dosage);
    expect(unifiedRes.body.zipCode).toBe(standaloneRes.body.zipCode);
    expect(unifiedRes.body.prices).toEqual(standaloneRes.body.prices);
    expect(unifiedRes.body.cheapest).toEqual(standaloneRes.body.cheapest);
    expect(unifiedRes.body.mostExpensive).toEqual(standaloneRes.body.mostExpensive);
    expect(unifiedRes.body.potentialSavings).toBe(standaloneRes.body.potentialSavings);
    expect(unifiedRes.body.savingsPercent).toBe(standaloneRes.body.savingsPercent);
  });
});
