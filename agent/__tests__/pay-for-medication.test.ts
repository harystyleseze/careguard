/**
 * Comprehensive tests for payForMedication (Issue #35).
 * All external dependencies mocked so no real Stellar calls are made.
 */

// vi.hoisted runs before any vi.mock factory
const { mockMppFetch, onProgressHolder, mockFiles, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return { mockMppFetch: vi.fn(), onProgressHolder, mockFiles: new Map<string, string>(), MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) };
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
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB123", sign: vi.fn(), signatureHint: () => MOCK_HINT }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [{ hint: () => MOCK_HINT }] }),
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn().mockResolvedValue({ hash: "b".repeat(64) }) }) },
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  payForMedication,
  payBill,
  checkSpendingPolicy,
  getSpendingTracker,
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

// --- Input validation ---

describe("payForMedication — input validation (Issue #35)", () => {
  it("rejects 0", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", 0);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects negative amount", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", -5);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects NaN", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", NaN);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects Infinity", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", Infinity);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects amounts above MAX_PAYMENT (1000)", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", 1001);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });
});

// --- Policy-blocked path ---

describe("payForMedication — policy-blocked (Issue #35)", () => {
  it("returns success:false with BLOCKED BY SPENDING POLICY when budget exceeded", async () => {
    // Set a very low medication budget so any payment is blocked
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, medicationMonthlyBudget: 5 });
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY SPENDING POLICY");
    // mppClient.fetch must NOT have been called
    expect(mockMppFetch).not.toHaveBeenCalled();
  });

  it("returns success:false when daily limit would be exceeded", async () => {
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, dailyLimit: 10 });
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY SPENDING POLICY");
    expect(mockMppFetch).not.toHaveBeenCalled();
  });
});

// --- Approval-required path ---

describe("payForMedication — approval required (Issue #35)", () => {
  it("records a pending transaction and returns success:false when amount > approvalThreshold", async () => {
    // Default approvalThreshold = 75; amount 80 is within budget+daily but needs approval
    const r = await payForMedication("p1", "Pharma", "Drug", 80);
    expect(r.success).toBe(false);
    expect(r.error).toContain("REQUIRES CAREGIVER APPROVAL");
    expect((r as any).transaction).toBeDefined();
    expect((r as any).transaction.status).toBe("pending");
    expect((r as any).transaction.amount).toBe(80);
    expect(mockMppFetch).not.toHaveBeenCalled();
  });
});

// --- MPP throws ---

describe("payForMedication — MPP failure (Issue #35)", () => {
  it("returns success:false with 'MPP payment failed' when mppClient.fetch throws", async () => {
    mockMppFetch.mockRejectedValueOnce(new Error("network timeout"));
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("MPP payment failed");
  });

  it("returns success:false when MPP response data.success is false", async () => {
    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, error: "insufficient funds" }),
      headers: { get: () => null },
    });
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("MPP payment failed");
  });

  it("returns a structured malformed-response rejection without debiting spending", async () => {
    mockMppFetch.mockResolvedValueOnce({
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
      text: async () => "<html>gateway error</html>",
      headers: { get: () => null },
    });

    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    const tracker = getSpendingTracker();

    expect(r).toMatchObject({
      success: false,
      ok: false,
      reason: "MALFORMED_RESPONSE",
    });
    expect(r.error).toContain("malformed response");
    expect((r as any).responsePreview).toContain("gateway error");
    expect(tracker.medications).toBe(0);
    expect(tracker.transactions).toHaveLength(0);
  });
});

// --- Success path ---

describe("payForMedication — success path (Issue #35)", () => {
  it("returns success:true and creates a completed transaction without relying on progress-event hashes", async () => {
    mockMppFetch.mockImplementationOnce(async () => {
      // Simulate the MPP progress event firing before the response resolves
      onProgressHolder.fn?.({ type: "paid", hash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" });
      return {
        json: async () => ({ success: true, order: { id: "order-111" } }),
        headers: { get: () => null },
      };
    });

    const r = await payForMedication("p1", "TestPharmacy", "Metformin", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx.status).toBe("completed");
    expect(tx.amount).toBe(50);
    expect(tx.stellarTxHash).toBeUndefined();
  });

  it("populates mppOrderId from data.order.id — never stored as stellarTxHash", async () => {
    // No onProgress event, no Payment-Receipt header → stellarTxHash stays undefined
    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-999" } }),
      headers: { get: () => null },
    });

    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx.mppOrderId).toBe("order-999");
    expect(tx.stellarTxHash).toBeUndefined();
  });

  it("sets stellarTxHash from Payment-Receipt header when no progress event fired", async () => {
    const validHash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const encodedReceipt = Buffer.from(
      JSON.stringify({ reference: validHash, hash: "hashfromheader" })
    ).toString("base64");

    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-222" } }),
      headers: { get: (h: string) => (h === "Payment-Receipt" ? encodedReceipt : null) },
    });

    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx.stellarTxHash).toBe(validHash);
    expect(tx.mppOrderId).toBe("order-222");
  });

  it("normalizes a non-hex receipt reference to undefined instead of storing a raw blob (#14)", async () => {
    const encodedReceipt = Buffer.from(
      JSON.stringify({ reference: "receipt-ref-abc" })
    ).toString("base64");

    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-223" } }),
      headers: { get: (h: string) => (h === "Payment-Receipt" ? encodedReceipt : null) },
    });

    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx.stellarTxHash).toBeUndefined();
    expect(tx.mppOrderId).toBe("order-223");
  });

  it("accumulates spending in the tracker after a successful payment", async () => {
    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-333" } }),
      headers: { get: () => null },
    });

    await payForMedication("p1", "Pharma", "Drug", 50);

    // A second payment of 45 would push today's spending to 95 (< 100 daily limit) — still allowed
    const check = checkSpendingPolicy(45, "medications");
    expect(check.allowed).toBe(true);
  });
});

// --- checkSpendingPolicy integration ---

describe("checkSpendingPolicy — basic rules (Issue #35)", () => {
  it("allows a payment within all limits", () => {
    const r = checkSpendingPolicy(50, "medications");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(false);
  });

  it("flags approval required when amount > approvalThreshold but within limits", () => {
    const r = checkSpendingPolicy(80, "medications");
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it("blocks when amount exceeds daily limit", () => {
    const r = checkSpendingPolicy(150, "medications");
    expect(r.allowed).toBe(false);
  });

  it("blocks when amount exceeds monthly medication budget", () => {
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, medicationMonthlyBudget: 20 });
    const r = checkSpendingPolicy(50, "medications");
    expect(r.allowed).toBe(false);
  });

  it("blocks medication + bill spending at the global monthly cap", async () => {
    setSpendingPolicy("rosa", {
      ...DEFAULT_POLICY,
      dailyLimit: 500,
      monthlyLimit: 120,
      medicationMonthlyBudget: 80,
      billMonthlyBudget: 40,
      approvalThreshold: 500,
    });
    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-global-cap" } }),
      headers: { get: () => null },
    });

    await payForMedication("p1", "Pharma", "Drug", 80);
    await payBill("provider-1", "Hospital", "Visit", 35);

    const r = checkSpendingPolicy(10, "bills");
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("overall monthly limit");
  });

  it("rejects policy saves where category budgets exceed monthlyLimit", () => {
    expect(() =>
      setSpendingPolicy("rosa", {
        ...DEFAULT_POLICY,
        monthlyLimit: 100,
        medicationMonthlyBudget: 80,
        billMonthlyBudget: 40,
      }),
    ).toThrow(/monthlyLimit/);
  });
});

// --- Concurrency / budget atomicity (Issue #209) ---

describe("payForMedication — concurrent calls cannot exceed budget (Issue #209)", () => {
  it("5 parallel calls totaling more than budget: only as many succeed as the budget allows", async () => {
    // Budget: $150 medication, $500 daily, each call $50 → exactly 3 should succeed
    setSpendingPolicy("rosa", {
      ...DEFAULT_POLICY,
      dailyLimit: 500,
      medicationMonthlyBudget: 150,
      billMonthlyBudget: 500,
      approvalThreshold: 500, // no approval gate
    });

    // All MPP calls succeed instantly
    mockMppFetch.mockResolvedValue({
      json: async () => ({ success: true, order: { id: "order-concurrent" } }),
      headers: { get: () => null },
    });

    const results = await Promise.all([
      payForMedication("p1", "Pharma", "DrugA", 50),
      payForMedication("p1", "Pharma", "DrugA", 50),
      payForMedication("p1", "Pharma", "DrugA", 50),
      payForMedication("p1", "Pharma", "DrugA", 50),
      payForMedication("p1", "Pharma", "DrugA", 50),
    ]);

    const successes = results.filter((r) => r.success);
    const blocked = results.filter(
      (r) => !r.success && (r as any).error?.includes("BLOCKED BY SPENDING POLICY"),
    );

    expect(successes.length).toBe(3);
    expect(blocked.length).toBe(2);
  });
});

// --- Platform cap (issue #83) ---

describe("payForMedication — platform cap (issue #83)", () => {
  const origCap = process.env.MAX_SINGLE_TX_USDC;

  beforeEach(() => {
    process.env.MAX_SINGLE_TX_USDC = "50";
    resetSpendingTracker("rosa");
    setSpendingPolicy("rosa", { ...DEFAULT_POLICY, medicationMonthlyBudget: 500, monthlyLimit: 1000, billMonthlyBudget: 500 });
  });

  afterEach(() => {
    if (origCap === undefined) delete process.env.MAX_SINGLE_TX_USDC;
    else process.env.MAX_SINGLE_TX_USDC = origCap;
  });

  it("blocks payForMedication above the platform cap", async () => {
    const r = await payForMedication("p1", "Pharma", "Drug", 51);
    expect(r.success).toBe(false);
    expect((r as any).error).toContain("BLOCKED BY PLATFORM CAP");
  });

  it("blocks payBill above the platform cap", async () => {
    const r = await payBill("provider1", "Hospital", "Visit", 51);
    expect(r.success).toBe(false);
    expect((r as any).error).toContain("BLOCKED BY PLATFORM CAP");
  });

  it("allows payForMedication equal to the platform cap (goes to policy check)", async () => {
    // Amount equals cap — not blocked by platform cap; reaches policy check
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    // Either succeeds or is blocked by policy/approval — but NOT by platform cap
    expect((r as any).error ?? "").not.toContain("BLOCKED BY PLATFORM CAP");
  });
});
