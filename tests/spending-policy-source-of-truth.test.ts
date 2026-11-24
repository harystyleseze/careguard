// vi.hoisted runs before any vi.mock factory
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB", sign: vi.fn(), signatureHint: vi.fn().mockReturnValue(Buffer.from([0xca, 0xfe])) }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({ addOperation: vi.fn().mockReturnThis(), setTimeout: vi.fn().mockReturnThis(), build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [] }) }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn(), feeStats: vi.fn() }) },
}));
vi.mock("@x402/stellar", () => ({ createEd25519Signer: vi.fn().mockReturnValue({}), ExactStellarScheme: vi.fn() }));
vi.mock("@x402/fetch", () => ({ wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()), x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }), decodePaymentResponseHeader: vi.fn() }));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

// Import SpendingPolicySchema from both import paths (Issue #1066)
import { SpendingPolicySchema as SchemaFromSharedTypes } from "../shared/types.ts";
import { SpendingPolicySchema as SchemaFromAgentTools } from "../agent/tools.ts";

describe("SpendingPolicySchema Single Source of Truth (Issue #1066)", () => {
  const validPolicy = {
    dailyLimit: 100,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 400,
    approvalThreshold: 75,
  };

  it("exports the exact same schema reference across both import paths", () => {
    expect(SchemaFromSharedTypes).toBe(SchemaFromAgentTools);
  });

  it("validates a conforming policy regardless of import path", () => {
    expect(SchemaFromSharedTypes.safeParse(validPolicy).success).toBe(true);
    expect(SchemaFromAgentTools.safeParse(validPolicy).success).toBe(true);
  });

  it("rejects dailyLimit > monthlyLimit via shared/types import and agent/tools import", () => {
    const invalid = { ...validPolicy, dailyLimit: 900, monthlyLimit: 800 };
    const resTypes = SchemaFromSharedTypes.safeParse(invalid);
    const resTools = SchemaFromAgentTools.safeParse(invalid);

    expect(resTypes.success).toBe(false);
    expect(resTools.success).toBe(false);
    expect(resTypes.error?.issues.some((i) => i.message.includes("dailyLimit cannot exceed monthlyLimit"))).toBe(true);
    expect(resTools.error?.issues.some((i) => i.message.includes("dailyLimit cannot exceed monthlyLimit"))).toBe(true);
  });

  it("rejects approvalThreshold > dailyLimit via shared/types import and agent/tools import", () => {
    const invalid = { ...validPolicy, approvalThreshold: 200, dailyLimit: 100 };
    const resTypes = SchemaFromSharedTypes.safeParse(invalid);
    const resTools = SchemaFromAgentTools.safeParse(invalid);

    expect(resTypes.success).toBe(false);
    expect(resTools.success).toBe(false);
    expect(resTypes.error?.issues.some((i) => i.message.includes("approvalThreshold cannot exceed dailyLimit"))).toBe(true);
    expect(resTools.error?.issues.some((i) => i.message.includes("approvalThreshold cannot exceed dailyLimit"))).toBe(true);
  });

  it("rejects medicationMonthlyBudget + billMonthlyBudget > monthlyLimit via shared/types import and agent/tools import", () => {
    const invalid = {
      ...validPolicy,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 400,
      monthlyLimit: 800,
    };
    const resTypes = SchemaFromSharedTypes.safeParse(invalid);
    const resTools = SchemaFromAgentTools.safeParse(invalid);

    expect(resTypes.success).toBe(false);
    expect(resTools.success).toBe(false);
    expect(
      resTypes.error?.issues.some((i) =>
        i.message.includes("medicationMonthlyBudget + billMonthlyBudget cannot exceed monthlyLimit"),
      ),
    ).toBe(true);
    expect(
      resTools.error?.issues.some((i) =>
        i.message.includes("medicationMonthlyBudget + billMonthlyBudget cannot exceed monthlyLimit"),
      ),
    ).toBe(true);
  });
});
