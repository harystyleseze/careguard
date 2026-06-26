import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MOCK_NETWORK = "1";
  process.env.NODE_ENV = "test";
  process.env.AGENT_SECRET_KEY = "test-agent-secret";
});

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GMOCKAGENT",
      sign: vi.fn(),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      feeStats: vi.fn(),
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
      transactions: vi.fn().mockReturnValue({
        transaction: vi.fn().mockReturnThis(),
        call: vi.fn(),
      }),
    }),
  },
}));

const {
  auditBill,
  checkDrugInteractions,
  comparePharmacyPrices,
  payForMedication,
  resetSpendingTracker,
  setSpendingPolicy,
} = await import("../tools.ts");

const POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
  notifications: { email: false, sms: false },
};

describe("MOCK_NETWORK tool paths", () => {
  beforeEach(() => {
    resetSpendingTracker();
    setSpendingPolicy(POLICY);
  });

  it("returns deterministic fake x402 receipts for service tools", async () => {
    const prices = await comparePharmacyPrices("Metformin", "90210");
    const audit = await auditBill([
      {
        description: "Office visit",
        cptCode: "99213",
        quantity: 1,
        chargedAmount: 130,
      },
    ]);
    const interactions = await checkDrugInteractions(["Metformin", "Atorvastatin"]);

    expect(prices.protocol.receipt.stellarTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect(audit.protocol.receipt.stellarTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect(interactions.protocol.receipt.stellarTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prices.protocol.mockNetwork).toBe(true);
    expect(audit.protocol.mockNetwork).toBe(true);
    expect(interactions.protocol.mockNetwork).toBe(true);
  });

  it("pays medication through a deterministic fake MPP receipt", async () => {
    const result = await payForMedication(
      "mock-pharmacy-1",
      "MockCare Pharmacy",
      "Metformin",
      12,
    );

    expect(result.success).toBe(true);
    expect((result as any).transaction.stellarTxHash).toMatch(/^[a-f0-9]{64}$/);
    expect((result as any).transaction.mppOrderId).toMatch(/^mock-mpp-medication-order-/);
  });
});
