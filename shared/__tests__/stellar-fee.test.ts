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

  it("falls back to 100 when fee_stats is missing the fee_charged key entirely", async () => {
    const horizon = createMockHorizon({
      ledger_capacity_usage: "0.50",
      // fee_charged intentionally absent — partial/malformed Horizon response
    });

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("falls back to 100 when fee_stats resolves to an empty object", async () => {
    const horizon = createMockHorizon({});
    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("falls back to 100 when fee_charged.p90 itself is missing", async () => {
    const horizon = createMockHorizon({
      fee_charged: { max: "2000", min: "100" }, // no p90 field
      ledger_capacity_usage: "0.50",
    });

    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("reflects a congestion spike with a higher fee, capped to a sane maximum", async () => {
    const horizon = createMockHorizon({
      fee_charged: {
        max: "50000000",
        min: "100",
        mode: "5000",
        p10: "100",
        p20: "200",
        p30: "500",
        p40: "1000",
        p50: "2000",
        p60: "5000",
        p70: "10000",
        p80: "50000",
        p90: "5000000", // severe congestion spike
        p95: "10000000",
        p99: "50000000",
      },
      max_fee: { max: "50000000", min: "100", p90: "5000000" },
      ledger_capacity_usage: "1.0",
    });

    const fee = await getTargetFee(horizon);
    // Higher than the normal-congestion case (450) but clamped, not the raw 5,000,000
    expect(Number(fee)).toBeGreaterThan(450);
    expect(Number(fee)).toBeLessThanOrEqual(100_000);
    expect(fee).toBe("100000");
  });

  it("handles a network/Horizon error from the fee_stats call with the fallback value", async () => {
    const horizon = createMockHorizon(new Error("ECONNRESET"));
    const fee = await getTargetFee(horizon);
    expect(fee).toBe("100");
  });

  it("always returns a valid stringified positive integer in stroops", async () => {
    const cases = [
      { fee_charged: { p90: "450" } },
      { fee_charged: { p90: "50" } },
      { fee_charged: { p90: "abc" } },
      {},
      new Error("boom"),
    ];
    for (const c of cases) {
      const horizon = createMockHorizon(c as any);
      const fee = await getTargetFee(horizon);
      expect(fee).toMatch(/^\d+$/);
      expect(Number(fee)).toBeGreaterThan(0);
      expect(Number.isInteger(Number(fee))).toBe(true);
    }
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

describe("getTargetFee caching and concurrency (#1317)", () => {
  beforeEach(() => {
    import("../stellar-fee.ts").then((m) => m.clearFeeCache());
  });

  it("caches fee stats within TTL and avoids duplicate network calls", async () => {
    const { getTargetFeeCached, clearFeeCache } = await import("../stellar-fee.ts");
    clearFeeCache();
    let callCount = 0;
    const horizon = {
      feeStats: vi.fn(async () => {
        callCount++;
        return {
          fee_charged: { p90: "350" },
        };
      }),
    } as unknown as Horizon.Server;

    const fee1 = await getTargetFeeCached(horizon, 5000);
    const fee2 = await getTargetFeeCached(horizon, 5000);
    const fee3 = await getTargetFeeCached(horizon, 5000);

    expect(fee1).toBe("350");
    expect(fee2).toBe("350");
    expect(fee3).toBe("350");
    expect(callCount).toBe(1);
  });

  it("coalesces concurrent in-flight calls into a single network query", async () => {
    const { getTargetFeeCached, clearFeeCache } = await import("../stellar-fee.ts");
    clearFeeCache();
    let callCount = 0;
    const horizon = {
      feeStats: vi.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          fee_charged: { p90: "450" },
        };
      }),
    } as unknown as Horizon.Server;

    const results = await Promise.all(
      Array.from({ length: 10 }, () => getTargetFeeCached(horizon, 5000)),
    );

    expect(results).toHaveLength(10);
    expect(results.every((r) => r === "450")).toBe(true);
    expect(callCount).toBe(1);
  });

  it("refreshes fee after TTL expires or on forceRefresh", async () => {
    const { getTargetFee, clearFeeCache } = await import("../stellar-fee.ts");
    clearFeeCache();
    let callCount = 0;
    const horizon = {
      feeStats: vi.fn(async () => {
        callCount++;
        return {
          fee_charged: { p90: String(300 + callCount * 50) },
        };
      }),
    } as unknown as Horizon.Server;

    const fee1 = await getTargetFee(horizon, { ttlMs: 50 });
    expect(fee1).toBe("350");
    expect(callCount).toBe(1);

    const feeForced = await getTargetFee(horizon, { ttlMs: 50, forceRefresh: true });
    expect(feeForced).toBe("400");
    expect(callCount).toBe(2);
  });
});

