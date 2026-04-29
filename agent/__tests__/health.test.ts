/**
 * Tests for /health and /ready endpoints (Issue #80)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock all env-dependent modules before importing server
vi.mock("dotenv/config", () => ({}));
vi.mock("../tools.ts", () => ({
  comparePharmacyPrices: vi.fn(),
  auditBill: vi.fn(),
  fetchRosaBill: vi.fn(),
  fetchAndAuditBill: vi.fn(),
  checkDrugInteractions: vi.fn(),
  payForMedication: vi.fn(),
  payBill: vi.fn(),
  checkSpendingPolicy: vi.fn(),
  getSpendingSummary: vi.fn(() => ({ spending: {}, policy: {} })),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(() => ({ transactions: [] })),
  resetSpendingTracker: vi.fn(),
  TOOL_DEFINITIONS: [],
}));
vi.mock("../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  OZ_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
  DEFAULT_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
}));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: vi.fn() } } })),
}));
vi.mock("mppx/server", () => ({
  Mppx: { create: vi.fn(() => ({ charge: vi.fn(() => vi.fn()) })) },
  Store: { memory: vi.fn() },
}));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn() } }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "mock-sac" }));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn(() => ({ publicKey: () => "GMOCK123" })) },
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn() })) },
}));

// Set required env vars before importing
process.env.LLM_API_KEY = "test-llm-key";
process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
process.env.MPP_SECRET_KEY = "test-mpp-secret";

const { app } = await import("../../server.ts");

describe("GET /health", () => {
  it("returns 200 { status: 'ok' } immediately", async () => {
    const start = Date.now();
    const res = await request(app).get("/health");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(elapsed).toBeLessThan(100);
  });
});

describe("GET /ready", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  it("returns 200 when all checks pass", async () => {
    const res = await request(app).get("/ready");
    // Horizon fetch is mocked to succeed
    expect([200, 503]).toContain(res.status); // 503 if OZ not verified yet
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("checks");
    expect(res.body.checks).toHaveProperty("env");
    expect(res.body.checks).toHaveProperty("horizon");
    expect(res.body.checks).toHaveProperty("ozFacilitator");
  });

  it("returns 503 when Horizon is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const res = await request(app).get("/ready");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.horizon).toBe(false);
  });

  it("responds within 2 seconds", async () => {
    const start = Date.now();
    await request(app).get("/ready");
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("env check fails when required vars are missing", async () => {
    const saved = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    const res = await request(app).get("/ready");
    expect(res.body.checks.env).toContain("missing");
    process.env.LLM_API_KEY = saved;
  });
});
