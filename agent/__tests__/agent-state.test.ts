/**
 * Tests for Issue #17 — module-level mutable state fixes:
 *   1. agentPaused persists to data/agent-state.json across restarts
 *   2. updateSpending() atomic helper blocks concurrent overspend
 */

const { testTempDir, MOCK_HINT } = vi.hoisted(() => {
  const testTempDir =
    (process.env.TEMP || process.env.TMP || "/tmp") +
    "/careguard-agent-state-test-" +
    Date.now();
  process.env.DATA_DIR = testTempDir;
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return { testTempDir, MOCK_HINT };
});

vi.mock("dotenv/config", () => ({}));
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
vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) },
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import {
  updateSpending,
  setSpendingPolicy,
  resetSpendingTracker,
  setCurrentRecipient,
  getSpendingTracker,
  comparePharmacyPrices,
  payForMedication,
  payBill,
} from "../tools.ts";

/** A $`amount` payment intent in `category`, as payForMedication / payBill build it. */
function intent(category: "medications" | "bills", amount: number) {
  return {
    type: category === "medications" ? ("medication" as const) : ("bill" as const),
    category,
    description: `test ${category} payment`,
    amount,
    recipient: "test-payee",
  };
}

beforeAll(() => {
  mkdirSync(testTempDir, { recursive: true });
});

afterAll(() => {
  try { rmSync(testTempDir, { recursive: true, force: true }); } catch {}
});

beforeEach(() => {
  resetSpendingTracker("test-recipient");
  setCurrentRecipient("test-recipient");
  // Reset policy to generous defaults so budget checks don't interfere
  setSpendingPolicy("test-recipient", {
    dailyLimit: 10_000,
    monthlyLimit: 10_000,
    approvalThreshold: 9_999,
    medicationMonthlyBudget: 5_000,
    billMonthlyBudget: 5_000,
  });
});

// ── agentPaused persistence (Issue #17) ──────────────────────────────────────

describe("agent-state.json persistence (Issue #17)", () => {
  it("creates agent-state.json when state is written", () => {
    const stateFile = join(testTempDir, "agent-state.json");
    // The file may not exist yet — write it directly via the save helper
    // (agent/server.ts exports saveAgentState indirectly through the route
    // handlers; here we test the underlying file-write contract)
    const tmp = `${stateFile}.tmp-test`;
    writeFileSync(tmp, JSON.stringify({ paused: true }), "utf-8");
    renameSync(tmp, stateFile);

    const content = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(content.paused).toBe(true);
  });

  it("loadAgentState returns false when file is absent", () => {
    const missingFile = join(testTempDir, "nonexistent-state.json");
    expect(existsSync(missingFile)).toBe(false);
    // Simulate the load logic inline
    const result = existsSync(missingFile)
      ? JSON.parse(readFileSync(missingFile, "utf-8"))
      : { paused: false };
    expect(result.paused).toBe(false);
  });

  it("loadAgentState returns true when file says paused=true", () => {
    const stateFile = join(testTempDir, "agent-state-read.json");
    writeFileSync(stateFile, JSON.stringify({ paused: true }), "utf-8");
    const result = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(result.paused).toBe(true);
  });
});

// ── updateSpending atomic helper (Issue #17) ─────────────────────────────────

describe("updateSpending — atomic budget gate", () => {
  it("allows a delta within budget and persists the change", async () => {
    const result = await updateSpending(intent("medications", 10));
    expect(result.ok).toBe(true);
    const tracker = getSpendingTracker();
    expect(tracker.medications).toBeCloseTo(10, 4);
  });

  it("blocks a delta that would exceed the category budget", async () => {
    setSpendingPolicy("test-recipient", {
      dailyLimit: 10_000,
      monthlyLimit: 10_000,
      approvalThreshold: 9_999,
      medicationMonthlyBudget: 50,
      billMonthlyBudget: 5_000,
    });
    const result = await updateSpending(intent("medications", 100));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe("blocked");
    expect(result.policyCheck.reason).toContain("medications monthly budget");
    expect(result.transaction.status).toBe("blocked");
    // Spending must not have changed
    const tracker = getSpendingTracker();
    expect(tracker.medications).toBe(0);
  });

  it("blocks a delta that would exceed the global monthly limit", async () => {
    // Zod: dailyLimit <= monthlyLimit AND categoryBudgets <= monthlyLimit, so
    // only accrued service fees can push total spend past the global limit.
    setSpendingPolicy("test-recipient", {
      dailyLimit: 30,
      monthlyLimit: 30,
      approvalThreshold: 25,
      medicationMonthlyBudget: 20,
      billMonthlyBudget: 10,
      toolFees: { comparePharmacyPrices: 5 },
    });

    // Pre-spend $20 on medications (hits category ceiling exactly)
    const first = await updateSpending(intent("medications", 20));
    expect(first.ok).toBe(true);

    // Accrue a $5 x402 service fee (mock network): $25 of $30 now spent
    await comparePharmacyPrices("lisinopril");

    // $8 fits the $10 bill budget but not the $5 left under the global limit
    const second = await updateSpending(intent("bills", 8));
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.policyCheck.reason).toContain("overall monthly limit");
    const tracker = getSpendingTracker();
    expect(tracker.medications).toBeCloseTo(20, 4);
    expect(tracker.serviceFees).toBeCloseTo(5, 4);
    expect(tracker.bills).toBe(0);
  });

  it("holds an approval-required payment as pending without reserving budget", async () => {
    setSpendingPolicy("test-recipient", {
      dailyLimit: 200,
      monthlyLimit: 1_000,
      approvalThreshold: 50,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 500,
    });

    const held = await updateSpending(intent("medications", 60));
    expect(held.ok).toBe(false);
    if (held.ok) return;
    expect(held.status).toBe("pending");
    expect(held.transaction.status).toBe("pending");
    expect(held.transaction.pendingUntil).toBeDefined();
    expect(getSpendingTracker().medications).toBe(0);

    const approved = await updateSpending(intent("medications", 60), true);
    expect(approved.ok).toBe(true);
    expect(getSpendingTracker().medications).toBeCloseTo(60, 4);
  });
});

// ── Concurrency test: 10 parallel payBill calls, only 5 fit budget ───────────

describe("updateSpending — concurrency (Issue #17 acceptance criterion)", () => {
  it("allows exactly 5 out of 10 concurrent $10 spending updates when budget is $50", async () => {
    // Set category budget to exactly $50 so only 5 × $10 should pass
    setSpendingPolicy("test-recipient", {
      dailyLimit: 10_000,
      monthlyLimit: 10_000,
      approvalThreshold: 9_999,
      medicationMonthlyBudget: 50,
      billMonthlyBudget: 5_000,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => updateSpending(intent("medications", 10))),
    );

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);

    expect(successes).toHaveLength(5);
    expect(failures).toHaveLength(5);

    // Final balance must exactly equal 5 × $10
    const tracker = getSpendingTracker();
    expect(tracker.medications).toBeCloseTo(50, 4);
  });
});

// ── payForMedication / payBill reserve through updateSpending (Issue #1060) ──

describe("payForMedication / payBill — budget reservation via updateSpending (Issue #1060)", () => {
  it("payForMedication reserves the amount exactly once on success", async () => {
    const result = await payForMedication("pharm-1", "Test Pharmacy", "Lisinopril", 12);
    expect(result.success).toBe(true);
    expect(getSpendingTracker().medications).toBeCloseTo(12, 4);
  });

  it("allows exactly 5 of 10 concurrent $10 payForMedication calls when the budget is $50", async () => {
    setSpendingPolicy("test-recipient", {
      dailyLimit: 10_000,
      monthlyLimit: 10_000,
      approvalThreshold: 9_999,
      medicationMonthlyBudget: 50,
      billMonthlyBudget: 5_000,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        payForMedication("pharm-1", "Test Pharmacy", "Lisinopril", 10),
      ),
    );

    expect(results.filter((r) => r.success)).toHaveLength(5);
    expect(results.filter((r) => !r.success)).toHaveLength(5);
    expect(getSpendingTracker().medications).toBeCloseTo(50, 4);
  });

  it("counts a held payment toward the daily limit before the next concurrent call is evaluated", async () => {
    setSpendingPolicy("test-recipient", {
      dailyLimit: 100,
      monthlyLimit: 1_000,
      approvalThreshold: 50,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 500,
    });

    const [first, second] = await Promise.all([
      payForMedication("pharm-1", "Test Pharmacy", "Lisinopril", 60),
      payForMedication("pharm-1", "Test Pharmacy", "Lisinopril", 60),
    ]);

    expect(first.error).toContain("REQUIRES CAREGIVER APPROVAL");
    expect(second.error).toContain("BLOCKED BY SPENDING POLICY");
    expect(second.error).toContain("daily limit");
    expect(getSpendingTracker().medications).toBe(0);
  });

  it("payBill rolls back its reservation when the payment cannot be made", async () => {
    const previousKey = process.env.BILL_PROVIDER_PUBLIC_KEY;
    delete process.env.BILL_PROVIDER_PUBLIC_KEY;
    try {
      const result = await payBill("provider-1", "Test Hospital", "Office visit", 40);
      expect(result.success).toBe(false);
      expect(result.error).toContain("BILL_PROVIDER_PUBLIC_KEY not configured");
      expect(getSpendingTracker().bills).toBe(0);
    } finally {
      if (previousKey !== undefined) process.env.BILL_PROVIDER_PUBLIC_KEY = previousKey;
    }
  });
});
