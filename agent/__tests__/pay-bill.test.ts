const { mockLoadAccount, mockSubmitTransaction, mockFeeStats, mockFiles, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  process.env.USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const mockLoadAccount = vi.fn().mockResolvedValue({});
  const mockSubmitTransaction = vi.fn().mockResolvedValue({ hash: "a".repeat(64) });
  const mockFeeStats = vi.fn().mockResolvedValue({ fee_charged: { p90: "100" } });
  const mockFiles = new Map<string, string>();
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return { mockLoadAccount, mockSubmitTransaction, mockFeeStats, mockFiles, MOCK_HINT };
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
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: mockLoadAccount, submitTransaction: mockSubmitTransaction, feeStats: mockFeeStats }) },
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
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn() }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  payBill,
  checkSpendingPolicy,
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

function validPolicy(overrides: Record<string, number> = {}) {
  return { ...DEFAULT_POLICY, ...overrides };
}

beforeEach(() => {
  mockFiles.clear();
  mockLoadAccount.mockResolvedValue({});
  mockSubmitTransaction.mockReset();
  mockSubmitTransaction.mockResolvedValue({ hash: "a".repeat(64) });
  mockFeeStats.mockResolvedValue({ fee_charged: { p90: "100" } });
  resetSpendingTracker("rosa");
  setSpendingPolicy("rosa", validPolicy());
});

// --- Input validation ---

describe("payBill — input validation", () => {
  it("rejects 0", async () => {
    const r = await payBill("p1", "Hosp", "bill", 0);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects negative amount", async () => {
    const r = await payBill("p1", "Hosp", "bill", -5);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects NaN", async () => {
    const r = await payBill("p1", "Hosp", "bill", NaN);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects Infinity", async () => {
    const r = await payBill("p1", "Hosp", "bill", Infinity);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });

  it("rejects amounts above MAX_PAYMENT (1000)", async () => {
    const r = await payBill("p1", "Hosp", "bill", 1001);
    expect(r.success).toBe(false);
    expect(r.error).toContain("positive finite number");
  });
});

// --- Platform cap (issue #83) ---

describe("payBill — platform cap (issue #83)", () => {
  const origCap = process.env.MAX_SINGLE_TX_USDC;

  beforeEach(() => {
    process.env.MAX_SINGLE_TX_USDC = "50";
    resetSpendingTracker("rosa");
    setSpendingPolicy("rosa", validPolicy({ billMonthlyBudget: 500, approvalThreshold: 50 }));
  });

  afterEach(() => {
    if (origCap === undefined) delete process.env.MAX_SINGLE_TX_USDC;
    else process.env.MAX_SINGLE_TX_USDC = origCap;
  });

  it("blocks above the platform cap", async () => {
    const r = await payBill("p1", "Hosp", "bill", 51);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY PLATFORM CAP");
  });

  it("allows amount equal to the platform cap", async () => {
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.error ?? "").not.toContain("BLOCKED BY PLATFORM CAP");
  });
});

// --- Policy-blocked path ---

describe("payBill — policy-blocked path", () => {
  it("returns success:false with BLOCKED BY SPENDING POLICY when bill budget exceeded", async () => {
    setSpendingPolicy("rosa", validPolicy({ billMonthlyBudget: 5, approvalThreshold: 5 }));
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY SPENDING POLICY");
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it("returns success:false when daily limit would be exceeded", async () => {
    setSpendingPolicy("rosa", validPolicy({ dailyLimit: 10, approvalThreshold: 10 }));
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BLOCKED BY SPENDING POLICY");
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it("records a blocked transaction entry", async () => {
    setSpendingPolicy("rosa", validPolicy({ billMonthlyBudget: 5, approvalThreshold: 5 }));
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    const tx = (r as any).transaction;
    expect(tx).toBeDefined();
    expect(tx.status).toBe("blocked");
    expect(tx.amount).toBe(50);
    expect(tx.category).toBe("bills");
  });
});

// --- Approval-required path ---

describe("payBill — approval required", () => {
  it("records a pending transaction and returns success:false when amount > approvalThreshold", async () => {
    const r = await payBill("p1", "Hosp", "bill", 80);
    expect(r.success).toBe(false);
    expect(r.error).toContain("REQUIRES CAREGIVER APPROVAL");
    const tx = (r as any).transaction;
    expect(tx).toBeDefined();
    expect(tx.status).toBe("pending");
    expect(tx.amount).toBe(80);
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });

  it("skips approval when skipApproval is true", async () => {
    const r = await payBill("p1", "Hosp", "bill", 80, true);
    expect(r.success).toBe(true);
    expect(mockSubmitTransaction).toHaveBeenCalled();
  });
});

// --- Missing BILL_PROVIDER_PUBLIC_KEY ---

describe("payBill — missing BILL_PROVIDER_PUBLIC_KEY", () => {
  const origKey = process.env.BILL_PROVIDER_PUBLIC_KEY;

  beforeEach(() => {
    delete process.env.BILL_PROVIDER_PUBLIC_KEY;
    setSpendingPolicy("rosa", validPolicy({ dailyLimit: 500, approvalThreshold: 500, monthlyLimit: 1000, billMonthlyBudget: 500 }));
  });

  afterEach(() => {
    process.env.BILL_PROVIDER_PUBLIC_KEY = origKey;
  });

  it("returns success:false with config error when env var is missing", async () => {
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("BILL_PROVIDER_PUBLIC_KEY not configured");
    expect(mockSubmitTransaction).not.toHaveBeenCalled();
  });
});

// --- Success path ---

describe("payBill — success path", () => {
  beforeEach(() => {
    setSpendingPolicy("rosa", validPolicy({ approvalThreshold: 500, dailyLimit: 500, monthlyLimit: 1000, billMonthlyBudget: 500 }));
  });

  it("builds tx with USDC asset, submits, and captures stellarTxHash", async () => {
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(true);
    const tx = (r as any).transaction;
    expect(tx).toBeDefined();
    expect(tx.status).toBe("completed");
    expect(tx.amount).toBe(50);
    expect(tx.stellarTxHash).toBe("a".repeat(64));
    expect(tx.category).toBe("bills");
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
  });

  it("accumulates bills spending in the tracker after success", async () => {
    await payBill("p1", "Hosp", "bill", 50);
    // Spending 500 would push total to 550 — exceeds the 500 billMonthlyBudget
    const check = checkSpendingPolicy(500, "bills");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("monthly budget");
  });

  it("returns hash with a real-length 64-char hex string", async () => {
    const fakeHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    mockSubmitTransaction.mockResolvedValue({ hash: fakeHash });
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(true);
    expect((r as any).transaction.stellarTxHash).toBe(fakeHash);
  });

  it("sends notification when amount > approvalThreshold", async () => {
    const r = await payBill("p1", "Hosp", "bill", 80, true);
    expect(r.success).toBe(true);
    expect((r as any).transaction.stellarTxHash).toBeDefined();
  });
});

// --- Stellar errors ---

describe("payBill — Stellar errors", () => {
  beforeEach(() => {
    setSpendingPolicy("rosa", validPolicy({ approvalThreshold: 500, dailyLimit: 500, monthlyLimit: 1000, billMonthlyBudget: 500 }));
  });

  it("returns clean error on op_underfunded", async () => {
    const horizonError = {
      response: {
        status: 400,
        data: {
          extras: {
            result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
          },
        },
      },
      message: "Operation underfunded",
    };
    mockSubmitTransaction.mockRejectedValueOnce(horizonError);

    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("Stellar USDC transfer failed");
    expect(r.error).toContain("op_underfunded");
  });

  it("recovers from tx_bad_seq via retry and succeeds", async () => {
    const badSeqError = new Error("tx_bad_seq");
    mockSubmitTransaction.mockRejectedValueOnce(badSeqError);
    mockSubmitTransaction.mockResolvedValueOnce({ hash: "c".repeat(64) });

    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(true);
    expect((r as any).transaction.stellarTxHash).toBe("c".repeat(64));
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(2);
  });

  it("returns clean error when tx_bad_seq retry also fails", async () => {
    const badSeqError = new Error("tx_bad_seq");
    mockSubmitTransaction.mockRejectedValue(badSeqError);

    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("Stellar USDC transfer failed");
  });

  it("returns clean error when loadAccount throws", async () => {
    mockLoadAccount.mockRejectedValueOnce(new Error("Horizon unavailable"));

    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain("Stellar USDC transfer failed");
  });

  it("returns clean error when feeStats throws (falls back to 100 stroops)", async () => {
    mockFeeStats.mockRejectedValueOnce(new Error("fee stats unavailable"));
    const r = await payBill("p1", "Hosp", "bill", 50);
    expect(r.success).toBe(true);
    expect((r as any).transaction.stellarTxHash).toBeDefined();
  });
});

// --- Concurrent submission (Issue #XXX) ---

describe("payBill — concurrent submission", () => {
  beforeEach(() => {
    setSpendingPolicy("rosa", validPolicy({ approvalThreshold: 500, dailyLimit: 500, monthlyLimit: 1000, billMonthlyBudget: 500 }));
  });

  it("handles 5 concurrent payBill calls with tx_bad_seq — all succeed after submission-mutex serialisation", { timeout: 15000 }, async () => {
    let submitCount = 0;
    let seq = 5;
    mockLoadAccount.mockImplementation(() => {
      return { sequenceNumber: () => String(seq++) };
    });
    mockSubmitTransaction.mockImplementation(() => {
      submitCount++;
      if (submitCount % 2 === 1) {
        throw new Error("tx_bad_seq");
      }
      return { hash: "a".repeat(64) };
    });

    const results = await Promise.all([
      payBill("p1", "Hosp", "bill", 50),
      payBill("p1", "Hosp", "bill", 50),
      payBill("p1", "Hosp", "bill", 50),
      payBill("p1", "Hosp", "bill", 50),
      payBill("p1", "Hosp", "bill", 50),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
      expect((r as any).transaction.stellarTxHash).toBeDefined();
    }
    // 5 calls × 2 submissions (1 fail + 1 retry success) = 10
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(10);
  });
});
