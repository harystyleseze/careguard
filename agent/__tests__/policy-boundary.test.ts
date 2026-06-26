/**
 * Boundary integration tests for spending-policy enforcement (#45).
 * External Stellar, MPP, x402, and filesystem effects are mocked so these tests
 * exercise the real exported payment and policy tools.
 */

const { mockMppFetch, onProgressHolder, mockFiles, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  process.env.SPENDING_TIMEZONE = "UTC";
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return {
    mockMppFetch: vi.fn(),
    onProgressHolder,
    mockFiles: new Map<string, string>(),
    MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) => mockFiles.get(String(filePath)) ?? "{}"),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    mockFiles.set(String(filePath), String(data));
  }),
  appendFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn((filePath: string) => mockFiles.has(String(filePath))),
  mkdirSync: vi.fn(),
  renameSync: vi.fn((from: string, to: string) => {
    const data = mockFiles.get(String(from));
    if (data !== undefined) {
      mockFiles.set(String(to), data);
      mockFiles.delete(String(from));
    }
  }),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: () => MOCK_HINT,
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({
      sign: vi.fn(),
      signatures: [{ hint: () => MOCK_HINT }],
    }),
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: vi.fn(),
      submitTransaction: vi.fn().mockResolvedValue({ hash: "b".repeat(64), fee: "100" }),
    }),
  },
}));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));
vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: vi.fn().mockImplementation((opts: any) => {
    if (opts?.onProgress) onProgressHolder.fn = opts.onProgress;
    return {};
  }),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: mockMppFetch }) },
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkSpendingPolicy,
  getSpendingSummary,
  payBill,
  payForMedication,
  resetSpendingTracker,
  setSpendingPolicy,
} from "../tools.ts";

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

beforeEach(() => {
  mockFiles.clear();
  mockMppFetch.mockReset();
  resetSpendingTracker("rosa");
  setSpendingPolicy("rosa", { ...DEFAULT_POLICY });
});

describe("policy enforcement boundaries (#45)", () => {
  it("allows medication amount exactly equal to medicationMonthlyBudget", () => {
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, dailyLimit: 300, approvalThreshold: 1000 });

    const result = checkSpendingPolicy(300, "medications");

    expect(result).toMatchObject({
      allowed: true,
      requiresApproval: false,
      currentSpending: 0,
      budgetRemaining: 0,
    });
  });

  it("blocks a medication payment one cent over the monthly budget with a precise reason", () => {
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, dailyLimit: 500, approvalThreshold: 1000 });

    const result = checkSpendingPolicy(300.01, "medications");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      "Payment of $300.01 exceeds medications monthly budget. Budget: $300, spent: $0.00, remaining: $300.00",
    );
    expect(result.requiresApproval).toBe(false);
  });

  it("allows amount exactly equal to the daily limit when other budgets permit it", () => {
    setSpendingPolicy("rosa", {
      ...DEFAULT_POLICY,
      dailyLimit: 250,
      medicationMonthlyBudget: 400,
      monthlyLimit: 900,
      approvalThreshold: 1000,
    });

    const result = checkSpendingPolicy(250, "medications");

    expect(result.allowed).toBe(true);
    expect(result.budgetRemaining).toBe(150);
  });

  it("requires approval when amount is exactly equal to approvalThreshold", async () => {
    const policyCheck = checkSpendingPolicy(75, "medications");

    expect(policyCheck.allowed).toBe(true);
    expect(policyCheck.requiresApproval).toBe(true);

    const result = await payForMedication("pharm-1", "Pharmacy", "Metformin", 75);

    expect(result.success).toBe(false);
    expect(result.error).toContain("REQUIRES CAREGIVER APPROVAL");
    expect((result as any).transaction).toMatchObject({
      amount: 75,
      status: "pending",
      category: "medications",
    });
    expect(mockMppFetch).not.toHaveBeenCalled();
  });

  it("records a blocked dashboard bill payment and does not poison the next valid payment", async () => {
    setSpendingPolicy("rosa", {
      dailyLimit: 600,
      monthlyLimit: 1000,
      medicationMonthlyBudget: 400,
      billMonthlyBudget: 500,
      approvalThreshold: 1000,
    });

    const blocked = await payBill("provider-1", "General Hospital", "Try Over-Budget Payment", 600);

    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain(
      "Payment of $600.00 exceeds bills monthly budget. Budget: $500, spent: $0.00, remaining: $500.00",
    );
    expect((blocked as any).transaction).toMatchObject({
      amount: 600,
      status: "blocked",
      category: "bills",
    });

    let summary = getSpendingSummary();
    expect(summary.spending.bills).toBe(0);
    expect(summary.transactionCount).toBe(1);
    expect(summary.recentTransactions[0].status).toBe("blocked");

    const paid = await payBill("provider-1", "General Hospital", "Follow-up copay", 50);

    expect(paid.success).toBe(true);
    expect((paid as any).transaction).toMatchObject({
      amount: 50,
      status: "completed",
      category: "bills",
    });
    summary = getSpendingSummary();
    expect(summary.spending.bills).toBe(50);
    expect(summary.transactionCount).toBe(2);
    expect(summary.recentTransactions.map((tx: any) => tx.status)).toEqual(["blocked", "completed"]);
  });
});
