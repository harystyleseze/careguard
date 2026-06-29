import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// Mock dependencies before importing server.ts
vi.mock("dotenv/config", () => ({}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock("../tools.ts", () => ({
  comparePharmacyPrices: vi.fn(),
  auditBill: vi.fn(),
  fetchRosaBill: vi.fn(),
  fetchAndAuditBill: vi.fn(),
  checkDrugInteractions: vi.fn(),
  payForMedication: vi.fn(),
  payBill: vi.fn(),
  checkSpendingPolicy: vi.fn(),
  getSpendingSummary: vi.fn(() => ({
    policy: {
      dailyLimit: 100,
      monthlyLimit: 800,
      medicationMonthlyBudget: 300,
      billMonthlyBudget: 500,
      approvalThreshold: 75,
    },
    spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    budgetRemaining: { medications: 300, bills: 500 },
    transactionCount: 0,
    recentTransactions: [],
  })),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(() => ({ transactions: [], policy: {}, spending: {} })),
  resetSpendingTracker: vi.fn(),
  TOOL_DEFINITIONS: [],
  validateToolInput: vi.fn((_name: string, input: Record<string, unknown>) => input),
}));

vi.mock("../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  OZ_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
  DEFAULT_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn(() => ({ publicKey: () => "GMOCKAGENTWALLETPUBKEY123456" })) },
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn() })) },
}));

vi.mock("mppx/server", () => ({
  Mppx: { create: vi.fn(() => ({ charge: vi.fn(() => vi.fn()) })) },
  Store: { memory: vi.fn() },
}));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn() } }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "mock-sac-testnet" }));

// Required env vars — set before server import to pass envSchema validation
process.env.LLM_API_KEY = "test-llm-key";
process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1PUBKEY";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDERPUBKEY";
process.env.MPP_SECRET_KEY = "test-mpp-secret-key";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";
process.env.AGENT_API_KEY = "correct-agent-api-key";

const { app } = await import("../../server.ts");

describe("Agent API Key Authentication Integration Tests", () => {
  it("should return 401 when requesting /agent/* without authorization header", async () => {
    const res = await request(app).get("/agent/status");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Unauthorized");
  });

  it("should return 401 when requesting /agent/* with an incorrect API key", async () => {
    const res = await request(app)
      .get("/agent/status")
      .set("Authorization", "Bearer wrong-api-key");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Unauthorized");
  });

  it("should return 200 when requesting /agent/* with the correct API key", async () => {
    const res = await request(app)
      .get("/agent/status")
      .set("Authorization", "Bearer correct-agent-api-key");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("paused");
  });

  it("should return 200 when requesting /agent/* with the correct API key in query params (for SSE)", async () => {
    const res = await request(app).get("/agent/status?apiKey=correct-agent-api-key");
    expect(res.status).toBe(200);
  });
});
