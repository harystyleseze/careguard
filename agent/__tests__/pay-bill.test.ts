import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  MATCHING_HINT,
  mockAppendFileSync,
  mockAsset,
  mockBuild,
  mockLoadAccount,
  mockOperationPayment,
  mockSubmit,
  mockTxHint,
  memoryFiles,
} = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  process.env.MOCK_NETWORK = "0";
  process.env.NODE_ENV = "test";
  process.env.SPENDING_TIMEZONE = "UTC";

  const MATCHING_HINT = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const memoryFiles = new Map<string, string>();
  const mockAppendFileSync = vi.fn((filePath: string, data: string) => {
    const key = String(filePath);
    memoryFiles.set(key, (memoryFiles.get(key) ?? "") + String(data));
  });
  const mockAsset = vi.fn();
  const mockLoadAccount = vi.fn();
  const mockOperationPayment = vi.fn();
  const mockSubmit = vi.fn();
  const mockTxHint = vi.fn(() => MATCHING_HINT);
  const mockBuild = vi.fn(() => ({
    sign: vi.fn(),
    signatures: [{ hint: mockTxHint }],
  }));

  return {
    MATCHING_HINT,
    mockAppendFileSync,
    mockAsset,
    mockBuild,
    mockLoadAccount,
    mockOperationPayment,
    mockSubmit,
    mockTxHint,
    memoryFiles,
  };
});

vi.mock("dotenv/config", () => ({}));

vi.mock("fs", () => ({
  appendFileSync: mockAppendFileSync,
  existsSync: vi.fn((filePath: string) => memoryFiles.has(String(filePath))),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((filePath: string) => memoryFiles.get(String(filePath)) ?? "{}"),
  renameSync: vi.fn((from: string, to: string) => {
    memoryFiles.set(String(to), memoryFiles.get(String(from)) ?? "");
    memoryFiles.delete(String(from));
  }),
  statSync: vi.fn(() => ({ size: 0 })),
  unlinkSync: vi.fn((filePath: string) => {
    memoryFiles.delete(String(filePath));
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    memoryFiles.set(String(filePath), String(data));
  }),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Asset: mockAsset,
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmit,
    }),
  },
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: () => MATCHING_HINT,
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Operation: { payment: mockOperationPayment },
  TransactionBuilder: vi.fn().mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: mockBuild,
  })),
}));

vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));

vi.mock("@x402/fetch", () => ({
  decodePaymentResponseHeader: vi.fn(),
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
}));

vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn() }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import {
  payBill,
  resetSpendingTracker,
  setSpendingPolicy,
} from "../tools.ts";

const defaultPolicy = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

beforeEach(() => {
  memoryFiles.clear();
  mockAppendFileSync.mockClear();
  mockAsset.mockClear();
  mockBuild.mockClear();
  mockLoadAccount.mockReset();
  mockLoadAccount.mockResolvedValue({ id: "GPUB123", sequence: "1", balances: [] });
  mockOperationPayment.mockReset();
  mockOperationPayment.mockReturnValue({ type: "payment" });
  mockSubmit.mockReset();
  mockSubmit.mockResolvedValue({ hash: "billtxhash" });
  mockTxHint.mockReturnValue(MATCHING_HINT);
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";

  resetSpendingTracker("rosa");
  setSpendingPolicy("rosa", defaultPolicy);
  mockAppendFileSync.mockClear();
});

function transactions() {
  return mockAppendFileSync.mock.calls
    .filter(([filePath]) => String(filePath).endsWith("transactions.jsonl"))
    .map(([, data]) => JSON.parse(String(data).trim()));
}

describe("payBill", () => {
  it("builds and submits a USDC payment, then records the Stellar hash", async () => {
    const result = await payBill("provider-1", "Hospital", "ER Visit", 35, true);

    expect(result.success).toBe(true);
    expect(mockAsset).toHaveBeenCalledWith(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
    expect(mockOperationPayment).toHaveBeenCalledWith({
      destination: "GBILLPROVIDER",
      asset: expect.anything(),
      amount: "35.0000000",
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(result.transaction).toMatchObject({
      type: "bill",
      amount: 35,
      recipient: "provider-1",
      stellarTxHash: "billtxhash",
      status: "completed",
      category: "bills",
    });
    expect(transactions()[0].stellarTxHash).toBe("billtxhash");
  });

  it("returns the same policy-blocked structure used by medication payments", async () => {
    setSpendingPolicy("rosa", { ...defaultPolicy, billMonthlyBudget: 10 });

    const result = await payBill("provider-1", "Hospital", "ER Visit", 35, true);

    expect(result).toEqual({
      success: false,
      error: expect.stringContaining("BLOCKED BY SPENDING POLICY"),
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns a config error when BILL_PROVIDER_PUBLIC_KEY is missing", async () => {
    delete process.env.BILL_PROVIDER_PUBLIC_KEY;

    const result = await payBill("provider-1", "Hospital", "ER Visit", 35, true);

    expect(result).toEqual({
      success: false,
      error: "BILL_PROVIDER_PUBLIC_KEY not configured",
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("rebuilds with a fresh account sequence and retries once on tx_bad_seq", async () => {
    mockSubmit
      .mockRejectedValueOnce(new Error("tx_bad_seq"))
      .mockResolvedValueOnce({ hash: "retryhash" });

    const result = await payBill("provider-1", "Hospital", "ER Visit", 35, true);

    expect(result.success).toBe(true);
    expect(result.transaction).toBeDefined();
    expect(result.transaction!.stellarTxHash).toBe("retryhash");
    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    expect(mockBuild).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
  });

  it("returns a clean op_underfunded error when Horizon reports insufficient balance", async () => {
    mockSubmit.mockRejectedValueOnce({
      response: {
        data: {
          extras: {
            result_codes: {
              operations: ["op_underfunded"],
            },
          },
        },
      },
    });

    const result = await payBill("provider-1", "Hospital", "ER Visit", 35, true);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Stellar USDC transfer failed");
    expect(result.error).toContain("op_underfunded");
  });
});
