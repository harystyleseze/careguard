import { describe, it, expect } from "vitest";
import { computeCategoryBreakdown } from "../spending-breakdown.ts";

const NOW = new Date("2026-10-17T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const tx = (over: Record<string, unknown>) =>
  ({ amount: 10, category: "medications", status: "completed", timestamp: daysAgo(1), ...over }) as any;

describe("computeCategoryBreakdown (#1185)", () => {
  it("groups completed spend into pharmacy, bills and fees per range", () => {
    const b = computeCategoryBreakdown(
      [
        tx({ amount: 12.5, category: "medications", timestamp: daysAgo(2) }),
        tx({ amount: 80, category: "bills", timestamp: daysAgo(10) }),
        tx({ amount: 0.002, category: "service_fees", timestamp: daysAgo(3) }),
        tx({ amount: 40, category: "bills", timestamp: daysAgo(45) }),
      ],
      NOW,
    );
    expect(b["7d"]).toEqual({ medications: 12.5, bills: 0, serviceFees: 0.002, total: 12.5, count: 2 });
    expect(b["30d"]).toEqual({ medications: 12.5, bills: 80, serviceFees: 0.002, total: 92.5, count: 3 });
    expect(b.all).toEqual({ medications: 12.5, bills: 120, serviceFees: 0.002, total: 132.5, count: 4 });
  });

  it("ignores payments that never moved money", () => {
    const b = computeCategoryBreakdown(
      ["pending", "approved", "blocked", "rejected", "cancelled", "disputed"].map((status) => tx({ status })),
      NOW,
    );
    expect(b.all.total).toBe(0);
    expect(b.all.count).toBe(0);
  });

  it("returns zeros for no transactions and skips unparseable timestamps for windowed ranges", () => {
    expect(computeCategoryBreakdown([], NOW).all).toEqual({ medications: 0, bills: 0, serviceFees: 0, total: 0, count: 0 });
    const b = computeCategoryBreakdown([tx({ timestamp: "not-a-date" })], NOW);
    expect(b["7d"].count).toBe(0);
    expect(b.all.count).toBe(1);
  });
});
