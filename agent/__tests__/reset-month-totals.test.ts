/**
 * Issue #1069: resetSpendingTracker must build its post-reset tracker with
 * createEmptySpendingTracker(), so monthTotals is populated immediately after
 * POST /agent/reset rather than only after the next payment rotates it.
 *
 * Boots the unified server with the real tools module; only network clients
 * (Stellar, x402, MPP, LLM) are mocked.
 */
import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("dotenv/config", () => ({}));
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: vi.fn() } } })),
}));
vi.mock("../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  OZ_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
  DEFAULT_FACILITATOR_URL: "https://channels.openzeppelin.com/x402/testnet",
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn(() => ({ publicKey: () => "GMOCKAGENTWALLETPUBKEY123456", sign: vi.fn() })),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn(), submitTransaction: vi.fn() })) },
}));
vi.mock("mppx/server", () => ({
  Mppx: { create: vi.fn(() => ({ charge: vi.fn(() => vi.fn()) })) },
  Store: { memory: vi.fn() },
}));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn() } }));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockImplementation(() => ({})) }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "mock-sac-testnet" }));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));

process.env.LLM_API_KEY = "test-llm-key";
process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1PUBKEY";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDERPUBKEY";
process.env.MPP_SECRET_KEY = "test-mpp-secret-key";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";
process.env.AGENT_API_KEY = "test-agent-api-key";

const { app } = await import("../../server.ts");
const auth = { Authorization: "Bearer test-agent-api-key" };

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("POST /agent/reset (#1069)", () => {
  it("leaves monthTotals populated for the current month immediately after the reset", async () => {
    const reset = await request(app).post("/agent/reset").set(auth);
    expect(reset.status).toBe(200);

    const tracker = await request(app).get("/agent/transactions").set(auth);
    expect(tracker.status).toBe(200);
    expect(tracker.body).toMatchObject({
      medications: 0,
      bills: 0,
      serviceFees: 0,
      transactions: [],
      monthTotals: { yearMonth: currentYearMonth(), medications: 0, bills: 0, serviceFees: 0 },
    });
  });
});
