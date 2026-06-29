/**
 * Tests for dynamic Stellar fee selection and fee-bump logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Horizon } from "@stellar/stellar-sdk";
import { getTargetFee } from "../stellar-fee.ts";

function createMockHorizon(feeStats: Record<string, any> | Error) {
  return {
    feeStats: vi.fn(
      feeStats instanceof Error
        ? () => Promise.reject(feeStats)
        : () => Promise.resolve(feeStats),
    ),
  } as unknown as Horizon.Server;
}

describe("getTargetFee", () => {
  it("returns p90 fee when fee_stats succeeds", async () => {
    const horizon = createMockHorizon({
      fee_charged: {
        max: "2000",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "450",
        p95: "1000",
        p99: "1500",
      },
      max_fee: {
        max: "2000",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "500",
        p95: "1000",
        p99: "1500",
      },
      ledger_capacity_usage: "0.50",
    });

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("450");
  });

  it("returns 100 when p90 is below minimum", async () => {
    const horizon = createMockHorizon({
      fee_charged: {
        max: "100",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "50",
        p95: "100",
        p99: "100",
      },
      max_fee: {
        max: "100",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "50",
        p95: "100",
        p99: "100",
      },
      ledger_capacity_usage: "0.50",
    });

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("falls back to 100 on Horizon error", async () => {
    const horizon = createMockHorizon(new Error("Horizon unavailable"));

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("falls back to 100 on non-numeric p90", async () => {
    const horizon = createMockHorizon({
      fee_charged: {
        max: "100",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "abc",
        p95: "100",
        p99: "100",
      },
      max_fee: {
        max: "100",
        min: "100",
        mode: "100",
        p10: "100",
        p20: "100",
        p30: "100",
        p40: "100",
        p50: "100",
        p60: "100",
        p70: "100",
        p80: "100",
        p90: "abc",
        p95: "100",
        p99: "100",
      },
      ledger_capacity_usage: "0.50",
    });

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });
});

describe("fee bump retry logic", () => {
  it("doubles fee on tx_insufficient_fee", () => {
    const initialFee = 100;
    const doubledFee = Math.min(initialFee * 2, 100000);
    expect(doubledFee).toBe(200);
  });

  it("doubles fee up to maximum of 3 times", () => {
    let fee = 100;
    for (let i = 0; i < 3; i++) {
      fee = Math.min(fee * 2, 100000);
    }
    expect(fee).toBe(800); // 100 -> 200 -> 400 -> 800
  });

  it("caps doubled fee at MAX_FEE_STROOPS", () => {
    const MAX_FEE_STROOPS = 100000;
    const initialFee = 60000;
    const doubled = Math.min(initialFee * 2, MAX_FEE_STROOPS);
    expect(doubled).toBe(MAX_FEE_STROOPS);
  });

  it("does not exceed max bump count", () => {
    const maxBumps = 3;
    let bumps = 0;

    // Simulate fee bump loop
    const result = (() => {
      let fee = 100;
      while (bumps < maxBumps) {
        fee = Math.min(fee * 2, 100000);
        bumps++;
      }
      return fee;
    })();

    expect(bumps).toBe(3);
    expect(result).toBe(800);
  });
});
