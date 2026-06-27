/**
 * Regression coverage for Stellar dynamic fee selection and fee-bump behavior.
 */

import { describe, expect, it, vi } from "vitest";
import {
  getTargetFee,
  isInsufficientFeeError,
  nextFeeBumpBaseFee,
  type HorizonFeeServer,
} from "../../shared/stellar-fee.ts";

function insufficientFeeError() {
  return {
    response: {
      data: {
        extras: {
          result_codes: {
            transaction: "tx_insufficient_fee",
          },
        },
      },
    },
  };
}

describe("Stellar dynamic fee selection", () => {
  it("targets the p90 fee from Horizon fee_stats", async () => {
    const horizon = {
      feeStats: vi.fn().mockResolvedValue({
        fee_charged: {
          p90: "350",
          mode: "100",
        },
      }),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon)).resolves.toBe("350");
  });

  it("falls back to 100 when Horizon fee_stats fails", async () => {
    const horizon = {
      feeStats: vi.fn().mockRejectedValue(new Error("offline")),
    } satisfies HorizonFeeServer;

    await expect(getTargetFee(horizon, { logger: { warn: vi.fn() } })).resolves.toBe("100");
  });
});

describe("Stellar fee-bump decisions", () => {
  it("doubles insufficient fees with a cap", () => {
    expect(nextFeeBumpBaseFee("100")).toBe("200");
    expect(nextFeeBumpBaseFee("90000", { maxFee: 100000 })).toBe("100000");
  });

  it("only fee-bumps tx_insufficient_fee errors", () => {
    expect(isInsufficientFeeError(insufficientFeeError())).toBe(true);
    expect(isInsufficientFeeError(new Error("tx_bad_seq"))).toBe(false);
  });
});
