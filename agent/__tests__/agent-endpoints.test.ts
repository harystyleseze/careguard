/**
 * Integration tests for /agent/* endpoints (Issue #42).
 *
 * Tests the unified server (server.ts) via supertest.
 * LLM is mocked via vi.hoisted so individual tests can chain mockResolvedValueOnce
 * for deterministic multi-turn exchanges.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Capture LLM create mock reference before any module is imported
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
      monthlyLimit: 500,
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

const { app } = await import("../../server.ts");
const auth = (req: any) => req.set("Authorization", "Bearer test-caregiver-token");

// ─────────────────────────────────────────────────────────────────────────────
// pause / status / run-while-paused
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /agent/pause → GET /agent/status → POST /agent/run (Issue #42)", () => {
  beforeEach(async () => {
    await auth(request(app).post("/agent/resume"));
  });

  it("POST /agent/pause sets paused=true", async () => {
    const res = await auth(request(app).post("/agent/pause"));
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
  });

  it("GET /agent/status reflects paused state", async () => {
    await auth(request(app).post("/agent/pause"));
    const res = await auth(request(app).get("/agent/status"));
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(true);
  });

  it("POST /agent/run returns 409 when agent is paused", async () => {
    await auth(request(app).post("/agent/pause"));
    const res = await auth(request(app).post("/agent/run"))
      .send({ task: "Compare medication prices" });
    expect(res.status).toBe(409);
    expect(res.body.paused).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resume
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /agent/resume (Issue #42)", () => {
  it("clears paused state", async () => {
    await auth(request(app).post("/agent/pause"));
    const res = await auth(request(app).post("/agent/resume"));
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(false);
  });

  it("GET /agent/status shows paused=false after resume", async () => {
    await auth(request(app).post("/agent/pause"));
    await auth(request(app).post("/agent/resume"));
    const res = await auth(request(app).get("/agent/status"));
    expect(res.body.paused).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// run validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /agent/run — validation (Issue #42)", () => {
  beforeEach(async () => {
    await auth(request(app).post("/agent/resume"));
  });

  it("missing task → 400", async () => {
    const res = await auth(request(app).post("/agent/run")).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("empty string task → 400", async () => {
    const res = await auth(request(app).post("/agent/run")).send({ task: "" });
    expect(res.status).toBe(400);
  });

  it("valid task + mocked LLM with 1 tool call → 200 with expected toolCalls array", async () => {
    // First call: LLM returns a single tool call (get_spending_summary — no side effects)
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-abc123",
                type: "function",
                function: { name: "get_spending_summary", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    // Second call: LLM returns final response
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: { role: "assistant", content: "Task complete.", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
    });

    const res = await auth(request(app).post("/agent/run"))
      .send({ task: "What is the current spending summary?" });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.toolCalls)).toBe(true);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].tool).toBe("get_spending_summary");
    expect(res.body.response).toBe("Task complete.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// policy
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /agent/policy (Issue #42)", () => {
  const VALID_POLICY = {
    dailyLimit: 150,
    monthlyLimit: 600,
    medicationMonthlyBudget: 350,
    billMonthlyBudget: 550,
    approvalThreshold: 80,
  };

  it("valid body → 200 with success: true", async () => {
    const res = await auth(request(app).post("/agent/policy")).send(VALID_POLICY);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("invalid body (missing fields) → 400", async () => {
    const res = await auth(request(app).post("/agent/policy")).send({ dailyLimit: 100 });
    expect(res.status).toBe(400);
  });

  it("negative value → 400", async () => {
    const res = await auth(request(app).post("/agent/policy"))
      .send({ ...VALID_POLICY, dailyLimit: -10 });
    expect(res.status).toBe(400);
  });

  it("zero value → 400", async () => {
    const res = await auth(request(app).post("/agent/policy"))
      .send({ ...VALID_POLICY, monthlyLimit: 0 });
    expect(res.status).toBe(400);
  });

  it("non-object body → 400", async () => {
    const res = await auth(request(app).post("/agent/policy"))
      .set("Content-Type", "application/json")
      .send('"just a string"');
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reset
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /agent/reset (Issue #42)", () => {
  it("returns { success: true }", async () => {
    const res = await auth(request(app).post("/agent/reset"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("GET /agent/transactions returns empty transactions after reset", async () => {
    await auth(request(app).post("/agent/reset"));
    const res = await auth(request(app).get("/agent/transactions"));
    expect(res.status).toBe(200);
    expect(res.body.transactions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API key header — with and without (Issue #42 + #10)
// ─────────────────────────────────────────────────────────────────────────────

describe("Agent endpoints — with and without X-API-Key header (Issue #42, #10)", () => {
  it("missing token returns 401", async () => {
    const res = await request(app).get("/agent/status");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toBe("Bearer");
  });

  it("wrong token returns 403", async () => {
    const res = await request(app)
      .get("/agent/status")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(403);
  });

  it("correct token returns 200", async () => {
    const res = await auth(request(app).get("/agent/status"));
    expect(res.status).toBe(200);
  });

  it("POST /agent/run requires the Bearer token before validation", async () => {
    const res = await request(app).post("/agent/run").send({});
    expect(res.status).toBe(401);
  });

  it("POST /agent/run with correct token reaches request validation", async () => {
    const res = await auth(request(app).post("/agent/run")).send({});
    expect(res.status).toBe(400);
  });
});
