/**
 * Cumulative Stellar network fee tracking (#1232).
 */
import { describe, it, expect } from "vitest";
import {
  computeNetworkFeeBreakdown,
  stroopsToXlm,
  summarizeNetworkFees,
} from "../stellar-fee.ts";

const NOW = new Date("2026-10-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("summarizeNetworkFees", () => {
  it("totals recorded fees in stroops and XLM, ignoring transactions without one", () => {
    const summary = summarizeNetworkFees(
      [
        { timestamp: daysAgo(1), networkFeeStroops: 100 },
        { timestamp: daysAgo(2), networkFeeStroops: 300 },
        { timestamp: daysAgo(2) }, // x402/MPP settlement: no network fee recorded
      ],
      "7d",
      NOW,
    );
    expect(summary.totalStroops).toBe(400);
    expect(summary.totalXlm).toBe(0.00004);
    expect(summary.count).toBe(2);
    expect(summary.averageStroops).toBe(200);
    expect(summary.maxStroops).toBe(300);
  });

  it("applies the time range filter", () => {
    const txs = [
      { timestamp: daysAgo(3), networkFeeStroops: 100 },
      { timestamp: daysAgo(20), networkFeeStroops: 100 },
      { timestamp: daysAgo(200), networkFeeStroops: 100 },
    ];
    const breakdown = computeNetworkFeeBreakdown(txs, NOW);
    expect(breakdown["7d"].count).toBe(1);
    expect(breakdown["30d"].count).toBe(2);
    expect(breakdown.all.count).toBe(3);
  });

  it("returns one trend entry per day for ranged views, including zero days", () => {
    const summary = summarizeNetworkFees([{ timestamp: daysAgo(0), networkFeeStroops: 100 }], "7d", NOW);
    expect(summary.trend).toHaveLength(7);
    expect(summary.trend.at(-1)).toMatchObject({ date: "2026-10-19", stroops: 100, count: 1 });
    expect(summary.trend[0]).toMatchObject({ stroops: 0, count: 0, spike: false });
  });

  it("only lists active days in the all-time trend", () => {
    const summary = summarizeNetworkFees(
      [
        { timestamp: daysAgo(5), networkFeeStroops: 100 },
        { timestamp: daysAgo(40), networkFeeStroops: 100 },
      ],
      "all",
      NOW,
    );
    expect(summary.trend.map((d) => d.count)).toEqual([1, 1]);
  });

  it("flags days whose average fee is at least 2x the typical fee as spikes", () => {
    const summary = summarizeNetworkFees(
      [
        { timestamp: daysAgo(6), networkFeeStroops: 100 },
        { timestamp: daysAgo(5), networkFeeStroops: 100 },
        { timestamp: daysAgo(4), networkFeeStroops: 100 },
        { timestamp: daysAgo(3), networkFeeStroops: 2_000 }, // congestion
      ],
      "7d",
      NOW,
    );
    expect(summary.typicalStroops).toBe(100);
    expect(summary.spikeDays).toBe(1);
    expect(summary.trend.find((d) => d.spike)?.date).toBe("2026-10-16");
  });

  it("does not flag spikes when fees are steady at the network minimum", () => {
    const summary = summarizeNetworkFees(
      [1, 2, 3].map((n) => ({ timestamp: daysAgo(n), networkFeeStroops: 100 })),
      "30d",
      NOW,
    );
    expect(summary.spikeDays).toBe(0);
  });

  it("is empty when nothing has a recorded fee", () => {
    const summary = summarizeNetworkFees([{ timestamp: daysAgo(1) }], "30d", NOW);
    expect(summary).toMatchObject({ totalStroops: 0, totalXlm: 0, count: 0, averageStroops: 0, spikeDays: 0 });
  });
});

describe("stroopsToXlm", () => {
  it("converts at 10,000,000 stroops per XLM", () => {
    expect(stroopsToXlm(10_000_000)).toBe(1);
    expect(stroopsToXlm(100)).toBe(0.00001);
  });
});
