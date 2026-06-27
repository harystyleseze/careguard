import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  getTargetFee,
  isInsufficientFeeError,
  nextFeeBumpBaseFee,
  submitWithFeeBump,
  type HorizonFeeServer,
  type HorizonSubmitServer,
} from "../stellar-fee.ts";

function buildSignedPayment(fee = "200") {
  const source = Keypair.random();
  const destination = Keypair.random();
  const account = new Account(source.publicKey(), "1");
  const tx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: destination.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();

  tx.sign(source);
  return { source, tx };
}

function insufficientFeeError() {
  return Object.assign(new Error("insufficient fee"), {
    response: {
      data: {
        extras: {
          result_codes: {
            transaction: "tx_insufficient_fee",
          },
        },
      },
    },
  });
}

describe("getTargetFee", () => {
  it("uses Horizon fee_stats p90", async () => {
    const horizon = {
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: {
          p90: "321",
          mode: "100",
        },
      }),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon)).resolves.toBe("321");
  });

  it("clamps fee_stats below the protocol minimum", async () => {
    const horizon = {
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: {
          p90: "25",
        },
      }),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon)).resolves.toBe("100");
  });

  it("clamps fee_stats to the configured maximum", async () => {
    const horizon = {
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: {
          p90: "250000",
        },
      }),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon, { maxFee: 1000 })).resolves.toBe("1000");
  });

  it("falls back to 100 when fee_stats is unavailable", async () => {
    const warn = vi.fn();
    const horizon = {
      feeStats: vi.fn().mockRejectedValue(new Error("horizon unavailable")),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon, { logger: { warn } })).resolves.toBe("100");
    expect(warn).toHaveBeenCalled();
  });
});

describe("fee bump helpers", () => {
  it("detects tx_insufficient_fee Horizon errors", () => {
    expect(isInsufficientFeeError(insufficientFeeError())).toBe(true);
    expect(isInsufficientFeeError(new Error("tx_bad_seq"))).toBe(false);
  });

  it("doubles the base fee and caps it", () => {
    expect(nextFeeBumpBaseFee("200")).toBe("400");
    expect(nextFeeBumpBaseFee("800", { maxFee: 1000 })).toBe("1000");
  });

  it("wraps the inner transaction in a signed fee-bump envelope", async () => {
    const { source, tx } = buildSignedPayment("200");
    const onFeeBump = vi.fn();
    const submitTransaction = vi
      .fn<(
        transaction: Transaction | FeeBumpTransaction,
        opts?: unknown,
      ) => Promise<{ hash: string; fee_charged?: string }>>()
      .mockRejectedValueOnce(insufficientFeeError())
      .mockResolvedValueOnce({ hash: "bumped", fee_charged: "400" });
    const server = { submitTransaction } satisfies HorizonSubmitServer;

    const result = await submitWithFeeBump(server, tx, source, Networks.TESTNET, {
      timeoutMs: 35000,
      onFeeBump,
    });

    expect(result).toEqual({ hash: "bumped", fee: "400", feeBumps: 1 });
    expect(submitTransaction).toHaveBeenCalledTimes(2);
    expect(submitTransaction.mock.calls[0][0]).toBe(tx);
    expect(submitTransaction.mock.calls[0][1]).toEqual({ timeout: 35000 });
    expect(submitTransaction.mock.calls[1][0]).toBeInstanceOf(FeeBumpTransaction);
    expect(onFeeBump).toHaveBeenCalledWith({
      attempt: 1,
      oldFee: "200",
      newFee: "400",
    });
  });

  it("tries at most three fee-bump envelopes", async () => {
    const { source, tx } = buildSignedPayment("100");
    const submitTransaction = vi
      .fn<(
        transaction: Transaction | FeeBumpTransaction,
        opts?: unknown,
      ) => Promise<{ hash: string }>>()
      .mockRejectedValue(insufficientFeeError());
    const server = { submitTransaction } satisfies HorizonSubmitServer;

    await expect(
      submitWithFeeBump(server, tx, source, Networks.TESTNET, { maxFeeBumps: 3 }),
    ).rejects.toThrow("insufficient fee");

    expect(submitTransaction).toHaveBeenCalledTimes(4);
    expect(submitTransaction.mock.calls.slice(1).map(([transaction]) => transaction)).toEqual([
      expect.any(FeeBumpTransaction),
      expect.any(FeeBumpTransaction),
      expect.any(FeeBumpTransaction),
    ]);
  });

  it("does not fee-bump non-fee failures", async () => {
    const { source, tx } = buildSignedPayment("100");
    const submitTransaction = vi
      .fn<(
        transaction: Transaction | FeeBumpTransaction,
        opts?: unknown,
      ) => Promise<{ hash: string }>>()
      .mockRejectedValue(new Error("tx_bad_seq"));
    const server = { submitTransaction } satisfies HorizonSubmitServer;

    await expect(
      submitWithFeeBump(server, tx, source, Networks.TESTNET),
    ).rejects.toThrow("tx_bad_seq");

    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
