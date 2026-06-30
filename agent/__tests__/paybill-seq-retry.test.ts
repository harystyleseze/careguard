/**
 * Tests for payBill tx_bad_seq reload-and-retry behaviour (Issues #197 / #282).
 */

const { mockLoadAccount, mockSubmitTransaction, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return {
    mockLoadAccount: vi.fn(),
    mockSubmitTransaction: vi.fn(),
    MOCK_HINT,
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
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
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
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
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  payBill,
  resetSpendingTracker,
  setSpendingPolicy,
  getPaybillSeqRetryTotal,
  resetPaybillSeqRetryTotal,
} from "../tools.ts";

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

const mockAccount = { id: "GPUB123" };

function makeSeqError() {
  const err: any = new Error("tx_bad_seq");
  err.response = { data: { extras: { result_codes: { transaction: "tx_bad_seq" } } } };
  return err;
}

beforeEach(() => {
  mockLoadAccount.mockReset();
  mockSubmitTransaction.mockReset();
  resetSpendingTracker();
  resetPaybillSeqRetryTotal();
  setSpendingPolicy({ ...DEFAULT_POLICY });
});

describe("payBill — tx_bad_seq retry (Issues #197 / #282)", () => {
  it("succeeds on first attempt, loadAccount called once, no retry counted", async () => {
    mockLoadAccount.mockResolvedValue(mockAccount);
    mockSubmitTransaction.mockResolvedValue({ hash: "txhash-ok" });

    const result = await payBill("provider-1", "General Hospital", "ER Visit", 50);

    expect(result.success).toBe(true);
    expect((result as any).transaction.stellarTxHash).toBe("txhash-ok");
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(getPaybillSeqRetryTotal()).toBe(0);
  });

  it("on tx_bad_seq: reloads account, retries once, succeeds", async () => {
    mockLoadAccount.mockResolvedValue(mockAccount);
    mockSubmitTransaction
      .mockRejectedValueOnce(makeSeqError())
      .mockResolvedValueOnce({ hash: "txhash-retry" });

    const result = await payBill("provider-1", "General Hospital", "ER Visit", 50);

    expect(result.success).toBe(true);
    expect((result as any).transaction.stellarTxHash).toBe("txhash-retry");
    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    expect(getPaybillSeqRetryTotal()).toBe(1);
  });

  it("surfaces error when retry also fails", async () => {
    mockLoadAccount.mockResolvedValue(mockAccount);
    mockSubmitTransaction
      .mockRejectedValueOnce(makeSeqError())
      .mockRejectedValueOnce(makeSeqError());

    const result = await payBill("provider-1", "General Hospital", "ER Visit", 50);

    expect(result.success).toBe(false);
    expect((result as any).error).toContain("Stellar USDC transfer failed");
    expect(getPaybillSeqRetryTotal()).toBe(1);
  });

  it("does not retry on non-sequence errors", async () => {
    mockLoadAccount.mockResolvedValue(mockAccount);
    const err: any = new Error("tx_insufficient_balance");
    err.response = { data: { extras: { result_codes: { transaction: "tx_insufficient_balance" } } } };
    mockSubmitTransaction.mockRejectedValueOnce(err);

    const result = await payBill("provider-1", "General Hospital", "ER Visit", 50);

    expect(result.success).toBe(false);
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(getPaybillSeqRetryTotal()).toBe(0);
  });

  it("paybill_seq_retry_total accumulates across calls", async () => {
    mockLoadAccount.mockResolvedValue(mockAccount);
    mockSubmitTransaction
      .mockRejectedValueOnce(makeSeqError())
      .mockResolvedValueOnce({ hash: "hash-1" })
      .mockRejectedValueOnce(makeSeqError())
      .mockResolvedValueOnce({ hash: "hash-2" });

    await payBill("provider-1", "Hospital A", "Visit", 20);
    await payBill("provider-2", "Hospital B", "Visit", 20);

    expect(getPaybillSeqRetryTotal()).toBe(2);
  });
});
