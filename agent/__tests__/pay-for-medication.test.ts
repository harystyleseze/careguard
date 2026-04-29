/**
 * Comprehensive tests for payForMedication (Issue #35).
 * All external dependencies mocked so no real Stellar calls are made.
 */

// vi.hoisted runs before any vi.mock factory
const { mockMppFetch, onProgressHolder } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return { mockMppFetch: vi.fn(), onProgressHolder };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB123", sign: vi.fn() }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ sign: vi.fn() }),
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
vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: vi.fn().mockImplementation((opts: any) => {
    if (opts?.onProgress) onProgressHolder.fn = opts.onProgress;
    return {};
  }),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: mockMppFetch }) },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  payForMedication,
  checkSpendingPolicy,
  resetSpendingTracker,
  setSpendingPolicy,
} from "../tools.ts";

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

beforeEach(() => {
  mockMppFetch.mockReset();
  resetSpendingTracker();
  setSpendingPolicy({ ...DEFAULT_POLICY });
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
    setSpendingPolicy({ ...DEFAULT_POLICY, medicationMonthlyBudget: 5 });
    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY SPENDING POLICY");
    // mppClient.fetch must NOT have been called
    expect(mockMppFetch).not.toHaveBeenCalled();
  });

  it("returns success:false when daily limit would be exceeded", async () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, dailyLimit: 10 });
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
});

// --- Success path ---

describe("payForMedication — success path (Issue #35)", () => {
  it("returns success:true, creates a completed transaction, and sets stellarTxHash from MPP progress event", async () => {
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
    expect(tx.stellarTxHash).toBe("abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
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
    const encodedReceipt = Buffer.from(
      JSON.stringify({ reference: "receipt-ref-abc", hash: "hashfromheader" })
    ).toString("base64");

    mockMppFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, order: { id: "order-222" } }),
      headers: { get: (h: string) => (h === "Payment-Receipt" ? encodedReceipt : null) },
    });

    const r = await payForMedication("p1", "Pharma", "Drug", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx.stellarTxHash).toBe("receipt-ref-abc");
    expect(tx.mppOrderId).toBe("order-222");
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
    setSpendingPolicy({ ...DEFAULT_POLICY, medicationMonthlyBudget: 20 });
    const r = checkSpendingPolicy(50, "medications");
    expect(r.allowed).toBe(false);
  });
});
