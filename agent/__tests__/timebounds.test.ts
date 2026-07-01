/**
 * Tests for issue #284 — STELLAR_TIMEBOUNDS_SECONDS env var and tx_too_late retry.
 */

const { mockSubmit, mockSetTimeout, mockBuild, mockLoadAccount } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  const mockSetTimeout = vi.fn().mockReturnThis();
  return {
    mockSubmit: vi.fn().mockResolvedValue({ hash: "TESTHASH" }),
    mockSetTimeout,
    mockBuild: vi.fn().mockReturnValue({
      sign: vi.fn(),
      signatures: [{ hint: () => Buffer.from([0xde, 0xad, 0xbe, 0xef]) }],
    }),
    mockLoadAccount: vi.fn().mockResolvedValue({ id: "GPUB123", sequence: "1", balances: [] }),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: () => Buffer.from([0xde, 0xad, 0xbe, 0xef]),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: mockSetTimeout,
    build: mockBuild,
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmit,
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
  stellar: vi.fn(),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { payBill } from "../tools.ts";

describe("#284 Stellar timebounds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadAccount.mockResolvedValue({ id: "GPUB123", sequence: "1", balances: [] });
  });

  it("uses STELLAR_TIMEBOUNDS_SECONDS env var default (60) in setTimeout", async () => {
    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);
    expect(mockSetTimeout).toHaveBeenCalledWith(60);
    expect(result.success).toBe(true);
  });

  it("retries once on tx_too_late with rebuilt transaction", async () => {
    mockSubmit
      .mockRejectedValueOnce(new Error("tx_too_late"))
      .mockResolvedValueOnce({ hash: "RETRYHASH" });

    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);

    // loadAccount called twice: first build + rebuild after tx_too_late
    expect(mockLoadAccount).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect((result as any).transaction?.stellarTxHash).toBe("RETRYHASH");
  });

  it("gives up after retry if tx_too_late persists", async () => {
    mockSubmit.mockRejectedValue(new Error("tx_too_late"));

    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/tx_too_late/);
  });
});
