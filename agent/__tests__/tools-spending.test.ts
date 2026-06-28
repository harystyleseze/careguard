import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";

// Pre-import configuration
const { testTempDir, MOCK_HINT } = vi.hoisted(() => {
  const tempBase = process.env.TEMP || process.env.TMP || "/tmp";
  const testTempDir = tempBase.replace(/\\/g, "/") + "/careguard-test-" + Date.now();
  process.env.DATA_DIR = testTempDir;
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return { testTempDir, MOCK_HINT };
});

// Mocks for Stellar and network connections
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: vi.fn().mockReturnValue(MOCK_HINT),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },

  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({
      sign: vi.fn(),
      signatures: [{ hint: vi.fn().mockReturnValue(MOCK_HINT) }],
    }),

  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn() }) },
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

// Now import target functions
import {
  setSpendingPolicy,
  getSpendingSummary,
  resetSpendingTracker,
  loadSpending,
  saveSpending,
  setCurrentRecipient,
  getSpendingTracker,
  checkSpendingPolicy,
} from "../tools.ts";

describe("Non-payment tools persistence & validation", () => {
  beforeEach(() => {
    // Reset/clean the temp dir per test recipient
    setCurrentRecipient("test_recipient");
    resetSpendingTracker();
  });

  afterEach(() => {
    // Clean up temp files
  });

  it("should fail setSpendingPolicy with invalid payload", () => {
    // Missing/negative/invalid constraints
    const invalidPolicies = [
      { dailyLimit: -10, monthlyLimit: 800, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 75 },
      { dailyLimit: 100, monthlyLimit: 800, medicationMonthlyBudget: 500, billMonthlyBudget: 500, approvalThreshold: 75 }, // med + bill > monthly limit
      { dailyLimit: 100, monthlyLimit: 800, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 150 }, // approval > daily limit
      { dailyLimit: 100, monthlyLimit: 800, medicationMonthlyBudget: NaN, billMonthlyBudget: 500, approvalThreshold: 75 },
    ];

    for (const invalidPolicy of invalidPolicies) {
      expect(() => setSpendingPolicy(invalidPolicy)).toThrow();
    }
  });

  it("should persist valid spending policy to policy.json", () => {
    const validPolicy = {
      dailyLimit: 200,
      monthlyLimit: 1000,
      medicationMonthlyBudget: 400,
      billMonthlyBudget: 600,
      approvalThreshold: 100,
    };

    setSpendingPolicy(validPolicy);

    const policyFile = join(testTempDir, "recipients", "test_recipient", "policy.json");
    expect(existsSync(policyFile)).toBe(true);

    const fileContent = JSON.parse(readFileSync(policyFile, "utf-8"));
    expect(fileContent.dailyLimit).toBe(200);
    expect(fileContent.monthlyLimit).toBe(1000);
    expect(fileContent.medicationMonthlyBudget).toBe(400);
    expect(fileContent.billMonthlyBudget).toBe(600);
    expect(fileContent.approvalThreshold).toBe(100);
  });

  it("should return correct totals via getSpendingSummary", () => {
    // Manually mutate spendingTracker to simulate some transactions
    const tracker = loadSpending();
    tracker.medications = 50.25;
    tracker.bills = 120.50;
    tracker.serviceFees = 1.0025;
    tracker.transactions = [
      {
        id: "tx-1",
        timestamp: new Date().toISOString(),
        type: "medication",
        description: "Med 1",
        amount: 50.25,
        recipient: "pharmacy-1",
        status: "completed",
        category: "medications",
      },
      {
        id: "tx-2",
        timestamp: new Date().toISOString(),
        type: "bill",
        description: "Bill 1",
        amount: 120.50,
        recipient: "provider-1",
        status: "completed",
        category: "bills",
      },
    ];
    saveSpending(tracker);

    const summary = getSpendingSummary();
    expect(summary.spending.medications).toBe(50.25);
    expect(summary.spending.bills).toBe(120.50);
    expect(summary.spending.serviceFees).toBe(1.0025);
    expect(summary.spending.total).toBe(171.75); // 50.25 + 120.50 + 1.00 = 171.75
    expect(summary.recentTransactions.length).toBeGreaterThan(0);
  });

  it("should reset spending tracker and persist", () => {
    const tracker = loadSpending();
    tracker.medications = 100;
    tracker.bills = 200;
    saveSpending(tracker);

    resetSpendingTracker();

    const newTracker = loadSpending();
    expect(newTracker.medications).toBe(0);
    expect(newTracker.bills).toBe(0);
    expect(newTracker.serviceFees).toBe(0);
    expect(newTracker.transactions.length).toBe(0);

    const snapshotFile = join(testTempDir, "recipients", "test_recipient", "spending.snapshot.json");
    const legacyFile = join(testTempDir, "recipients", "test_recipient", "spending.json");
    expect(existsSync(snapshotFile)).toBe(true);
    expect(existsSync(legacyFile)).toBe(true);
  });

  it("should perform persistence round-trip correctly", async () => {
    // 1. Write some policy and spending
    const validPolicy = {
      dailyLimit: 300,
      monthlyLimit: 1200,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 700,
      approvalThreshold: 150,
    };
    setSpendingPolicy(validPolicy);

    const tracker = loadSpending();
    tracker.medications = 150;
    saveSpending(tracker);

    // Simulate reload by calling loadSpending again or forcing module reset logic
    // Clear cache by manually deleting from spendingCache or importing freshly
    vi.resetModules();
    
    // Check if files still exist in the temp directory
    const policyFile = join(testTempDir, "recipients", "test_recipient", "policy.json");
    expect(existsSync(policyFile)).toBe(true);

    const policySaved = JSON.parse(readFileSync(policyFile, "utf-8"));
    expect(policySaved.dailyLimit).toBe(300);
    expect(policySaved.monthlyLimit).toBe(1200);

    const spendingSaved = JSON.parse(readFileSync(join(testTempDir, "recipients", "test_recipient", "spending.json"), "utf-8"));
    expect(spendingSaved.medications).toBe(150);
  });
});

describe("checkSpendingPolicy — float underflow (issue #287)", () => {
  const POLICY = {
    dailyLimit: 500,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
  };

  // Helper: write a crafted spending object into the in-memory tracker by
  // saving it to the cache (via saveSpending) then reloading via setCurrentRecipient.
  function injectSpending(medications: number, bills = 0) {
    saveSpending({ medications, bills, serviceFees: 0, transactions: [] });
    setCurrentRecipient("test_recipient"); // reloads from the just-updated cache
  }

  beforeEach(() => {
    setCurrentRecipient("test_recipient");
    resetSpendingTracker();
    setSpendingPolicy(POLICY);
  });

  it("blocks payment when remaining is a tiny negative float (synthetic underflow)", () => {
    // Simulate floating-point underflow: budget fully consumed plus a rounding artifact
    injectSpending(POLICY.medicationMonthlyBudget + 1e-10);

    const result = checkSpendingPolicy(0.01, "medications");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget/i);
  });

  it("blocks payment when global remaining is a tiny negative float", () => {
    // totalMonthlySpending slightly over monthlyLimit due to float drift
    injectSpending(400, POLICY.monthlyLimit - 400 + 1e-10);

    const result = checkSpendingPolicy(0.01, "bills");
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/monthly limit/i);
  });

  it("returns non-negative budgetRemaining after rounding", () => {
    // Set spending to exactly budget — underflow rounds to 0, budgetRemaining must be >= 0
    injectSpending(POLICY.medicationMonthlyBudget);

    const result = checkSpendingPolicy(0.01, "medications");
    if (!result.allowed && result.budgetRemaining !== undefined) {
      expect(result.budgetRemaining).toBeGreaterThanOrEqual(0);
    }
  });
});
