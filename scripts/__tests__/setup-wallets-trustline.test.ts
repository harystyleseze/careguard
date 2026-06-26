import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadAccountMock,
  submitTransactionMock,
  changeTrustMock,
  txSignMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  loadAccountMock: vi.fn(),
  submitTransactionMock: vi.fn(),
  changeTrustMock: vi.fn(() => ({ type: "changeTrust" })),
  txSignMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../shared/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
  },
}));

vi.mock("@stellar/stellar-sdk", () => {
  const builder = vi.fn().mockImplementation(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn(() => ({ sign: txSignMock })),
  }));

  return {
    Horizon: {
      Server: vi.fn(() => ({
        loadAccount: loadAccountMock,
        submitTransaction: submitTransactionMock,
      })),
    },
    Asset: vi.fn().mockImplementation((code: string, issuer: string) => ({ code, issuer })),
    Networks: { TESTNET: "Test SDF Network ; September 2015" },
    Operation: { changeTrust: changeTrustMock },
    TransactionBuilder: builder,
    Keypair: {
      fromRawEd25519Seed: vi.fn(),
      fromSecret: vi.fn(),
    },
  };
});

const { addUsdcTrustline } = await import("../setup-wallets.ts");

const keypair = {
  publicKey: () => "GTESTPUBLICKEY",
  sign: vi.fn(),
} as any;

function accountWithBalances(balances: any[] = []) {
  return { balances };
}

function txBadSeqError() {
  return {
    response: {
      data: {
        extras: {
          result_codes: { transaction: "tx_bad_seq" },
        },
      },
    },
  };
}

describe("setup-wallets USDC trustline setup", () => {
  beforeEach(() => {
    loadAccountMock.mockReset();
    submitTransactionMock.mockReset();
    changeTrustMock.mockClear();
    txSignMock.mockClear();
    loggerWarnMock.mockClear();
  });

  it("reloads account state and retries once after tx_bad_seq", async () => {
    loadAccountMock
      .mockResolvedValueOnce(accountWithBalances())
      .mockResolvedValueOnce(accountWithBalances());
    submitTransactionMock
      .mockRejectedValueOnce(txBadSeqError())
      .mockResolvedValueOnce({});

    await addUsdcTrustline(keypair);

    expect(loadAccountMock).toHaveBeenCalledTimes(2);
    expect(loadAccountMock).toHaveBeenNthCalledWith(1, "GTESTPUBLICKEY");
    expect(loadAccountMock).toHaveBeenNthCalledWith(2, "GTESTPUBLICKEY");
    expect(submitTransactionMock).toHaveBeenCalledTimes(2);
    expect(txSignMock).toHaveBeenCalledTimes(2);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: "GTESTPUB" }),
      expect.stringContaining("tx_bad_seq"),
    );
  });

  it("skips transaction submission when the reloaded account already has the trustline", async () => {
    loadAccountMock.mockResolvedValueOnce(
      accountWithBalances([
        {
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        },
      ]),
    );

    await addUsdcTrustline(keypair);

    expect(loadAccountMock).toHaveBeenCalledTimes(1);
    expect(changeTrustMock).not.toHaveBeenCalled();
    expect(submitTransactionMock).not.toHaveBeenCalled();
  });

  it("fails fast for non-sequence Horizon errors", async () => {
    loadAccountMock.mockResolvedValueOnce(accountWithBalances());
    submitTransactionMock.mockRejectedValueOnce(new Error("op_no_trust"));

    await expect(addUsdcTrustline(keypair)).rejects.toThrow("op_no_trust");

    expect(loadAccountMock).toHaveBeenCalledTimes(1);
    expect(submitTransactionMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });
});
