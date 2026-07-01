/**
 * Tests for MAX_TOOL_CALLS_PER_RUN cap (issue #90).
 *
 * Uses the main server.ts (which has export { app }) following the same pattern
 * as other agent tests. The LLM is mocked to return infinite tool call batches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("dotenv/config", () => ({}));
vi.mock("../../shared/audit-log.ts", () => ({
  appendAuditEntry: vi.fn(),
  auditRouter: () => (req: any, res: any, next: any) => next(),
}));
vi.mock("../../shared/cors.ts", () => ({
  createCorsMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../shared/security-middleware.ts", () => ({
  applySecurityMiddleware: vi.fn(),
}));
vi.mock("../../shared/sentry.ts", () => ({
  initSentry: vi.fn(async () => ({
    enabled: false,
    requestHandler: () => (_req: any, _res: any, next: any) => next(),
    errorHandler: () => (err: any, _req: any, _res: any, next: any) => next(err),
    captureException: vi.fn(),
  })),
}));
vi.mock("../../agent/tools.ts", () => ({
  comparePharmacyPrices: vi.fn(),
  auditBill: vi.fn(),
  fetchRosaBill: vi.fn(),
  fetchAndAuditBill: vi.fn(),
  checkDrugInteractions: vi.fn(),
  payForMedication: vi.fn(),
  payBill: vi.fn(),
  checkSpendingPolicy: vi.fn(),
  getSpendingSummary: vi.fn(() => ({})),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(() => ({ transactions: [], medications: 0, bills: 0, serviceFees: 0 })),
  resetSpendingTracker: vi.fn(),
  TOOL_DEFINITIONS: [],
  validateToolInput: vi.fn((_name: string, input: Record<string, unknown>) => input),
}));
vi.mock("../../shared/wallet-balance.ts", () => ({
  checkWalletBalance: vi.fn(async () => ({ action: "ok" })),
  formatResult: vi.fn(() => "ok"),
}));
vi.mock("../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  OZ_FACILITATOR_URL: "https://mock.oz",
  DEFAULT_FACILITATOR_URL: "https://mock.oz",
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

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// Use a cap of 5 to keep the test fast
process.env.LLM_API_KEY = "test-key";
process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
process.env.MPP_SECRET_KEY = "test-mpp-secret";
process.env.MAX_TOOL_CALLS_PER_RUN = "5";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";

const { app } = await import("../../server.ts");
const auth = (req: any) => req.set("Authorization", "Bearer test-agent-api-key");

describe("tool call cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops at cap boundary and returns truncated:true", async () => {
    // Each call returns a batch of 3 tool calls.
    // With cap=5: first batch (3) passes (total=3), second batch (3+3=6>5) is rejected.
    // So exactly 3 tool calls execute and response has truncated:true.
    mockCreate.mockImplementation(async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "tc-1", type: "function", function: { name: "get_spending_summary", arguments: "{}" } },
              { id: "tc-2", type: "function", function: { name: "get_spending_summary", arguments: "{}" } },
              { id: "tc-3", type: "function", function: { name: "get_spending_summary", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));

    const res = await auth(request(app).post("/agent/run"))
      .send({ task: "Run the spending summary repeatedly" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBe(true);
    expect(res.body.toolCalls.length).toBe(3);
  });

  it("does not truncate when under cap", async () => {
    // Returns a single batch of 2, then stop
    let calls = 0;
    mockCreate.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return {
          choices: [{ message: { role: "assistant", content: null, tool_calls: [
            { id: "tc-1", type: "function", function: { name: "get_spending_summary", arguments: "{}" } },
            { id: "tc-2", type: "function", function: { name: "get_spending_summary", arguments: "{}" } },
          ] }, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }
      return {
        choices: [{ message: { role: "assistant", content: "Done.", tool_calls: [] }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      };
    });

    const res = await auth(request(app).post("/agent/run"))
      .send({ task: "Check spending summary" });

    expect(res.status).toBe(200);
    expect(res.body.truncated).toBeFalsy();
  });
});
