/**
 * CORS & caregiver auth tests (Issue #267).
 *
 * Verifies:
 *  - Unauthenticated requests are rejected with 401
 *  - Invalid tokens are rejected with 403
 *  - CORS headers are pinned to ALLOWED_ORIGINS
 *  - Cookie-based auth requires a matching CSRF header
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// Capture LLM mock before any module is imported
const { createMock } = vi.hoisted(() => {
  const createMock = vi.fn();
  return { createMock };
});

vi.mock("dotenv/config", () => ({}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
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
process.env.ALLOWED_ORIGINS = "http://localhost:3000";

const { app } = await import("../../server.ts");
const auth = (req: any) => req.set("Authorization", "Bearer test-agent-api-key");

describe("Caregiver Auth & CORS Security (Issue #267)", () => {
  // Auth tests: use POST /agent/run (rate-limited to 5/min, but only 2 calls total)
  it("rejects requests without an agent API key with 401", async () => {
    const res = await request(app).post("/agent/run").send({ task: "test" });
    expect(res.status).toBe(401);
  });

  it("rejects requests with an invalid agent API key with 401", async () => {
    const res = await request(app)
      .post("/agent/run")
      .set("Authorization", "Bearer invalid-token")
      .send({ task: "test" });
    expect(res.status).toBe(401);
  });

  // CORS + cookie tests: use /health (unlimited rate limit)
  it("returns CORS header for allowed origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:3000");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("does not return CORS header for disallowed origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://evil.com");
    // The server should not echo back the evil origin
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.com");
  });

  it("rejects cookie auth when CSRF header is missing", async () => {
    const res = await request(app)
      .get("/health")
      .set("Cookie", "caregiver_token=test-caregiver-token; csrf_token=my-csrf-token")
      .send();
    // /health doesn't require auth, so test CSRF on a caregiver-token endpoint
    const agentRes = await request(app)
      .get("/recipients")
      .set("Cookie", "caregiver_token=test-caregiver-token; csrf_token=my-csrf-token")
      .send();
    expect(agentRes.status).toBe(403);
    expect(agentRes.body.error).toContain("CSRF");
  });

  it("accepts cookie auth when valid CSRF header is provided", async () => {
    const res = await request(app)
      .get("/recipients")
      .set("Cookie", "caregiver_token=test-caregiver-token; csrf_token=my-csrf-token")
      .set("X-CSRF-Token", "my-csrf-token")
      .send();
    expect(res.status).toBe(200);
  });
});
