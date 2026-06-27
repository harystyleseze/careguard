// vi.hoisted runs before any vi.mock factory — must set env before module imports
vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    if (String(filePath).includes("spending.snapshot.json")) {
      return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [], _snapshotTxCount: 0 });
    }
    if (String(filePath).includes("spending.json")) {
      return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
    }
    return "{}";
  }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn((p: string) => String(p).includes("spending")),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB", sign: vi.fn(), signatureHint: vi.fn().mockReturnValue(Buffer.from([0xca, 0xfe, 0xba, 0xbe])) }) },
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

import { describe, it, expect } from "vitest";
import { SpendingPolicySchema } from "../tools.ts";

/**
 * Vitest: SpendingPolicySchema (Issue #210)
 * Covers all invalid combinations per acceptance criteria.
 */

const VALID_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 400,
  approvalThreshold: 75,
};

describe("SpendingPolicySchema — required field validation (Issue #210)", () => {
  it("accepts a valid minimal policy", () => {
    expect(() => SpendingPolicySchema.parse(VALID_POLICY)).not.toThrow();
  });

  it("accepts holdTimeSeconds: 0 (default policy value)", () => {
    expect(() => SpendingPolicySchema.parse({ ...VALID_POLICY, holdTimeSeconds: 0 })).not.toThrow();
  });

  it("rejects dailyLimit: -100", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: -100 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/greater than 0/i);
  });

  it("rejects dailyLimit: 0", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects dailyLimit: NaN", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: NaN });
    expect(result.success).toBe(false);
  });

  it("rejects dailyLimit: Infinity", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: Infinity });
    expect(result.success).toBe(false);
  });

  it("rejects approvalThreshold: 999_999_999 (exceeds max)", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, approvalThreshold: 999_999_999 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/cannot exceed/i);
  });

  it("rejects monthlyLimit: -1", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, monthlyLimit: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects medicationMonthlyBudget: 0", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, medicationMonthlyBudget: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects billMonthlyBudget: -50", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, billMonthlyBudget: -50 });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = SpendingPolicySchema.safeParse({ dailyLimit: 100 });
    expect(result.success).toBe(false);
  });
});

describe("SpendingPolicySchema — cross-field validation (Issue #210)", () => {
  it("rejects dailyLimit > monthlyLimit", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: 900, monthlyLimit: 800 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("dailyLimit cannot exceed monthlyLimit"))).toBe(true);
  });

  it("rejects approvalThreshold > dailyLimit", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, approvalThreshold: 200, dailyLimit: 100 });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.message.includes("approvalThreshold cannot exceed dailyLimit"))).toBe(true);
  });

  it("rejects medicationMonthlyBudget + billMonthlyBudget > monthlyLimit", () => {
    const result = SpendingPolicySchema.safeParse({
      ...VALID_POLICY,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 400,
      monthlyLimit: 800,
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.some((i) =>
        i.message.includes("medicationMonthlyBudget + billMonthlyBudget cannot exceed monthlyLimit"),
      ),
    ).toBe(true);
  });
});

describe("SpendingPolicySchema — upper bound validation (Issue #210)", () => {
  it("rejects dailyLimit > 10_000", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, dailyLimit: 10_001, monthlyLimit: 100_000 });
    expect(result.success).toBe(false);
  });

  it("rejects monthlyLimit > 100_000", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, monthlyLimit: 100_001 });
    expect(result.success).toBe(false);
  });

  it("rejects holdTimeSeconds > 86_400", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, holdTimeSeconds: 86_401 });
    expect(result.success).toBe(false);
  });

  it("rejects holdTimeSeconds < 0", () => {
    const result = SpendingPolicySchema.safeParse({ ...VALID_POLICY, holdTimeSeconds: -1 });
    expect(result.success).toBe(false);
  });
});
