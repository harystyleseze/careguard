import { describe, expect, it } from "vitest";
import { sortTransactionsNewestFirst } from "../lib/transactions";
import type { Transaction } from "../lib/types";

function tx(id: string, timestamp: string): Transaction {
  return {
    id,
    timestamp,
    type: "service_fee",
    description: id,
    amount: 0.002,
    recipient: "x402",
    status: "completed",
    category: "service",
  };
}

describe("sortTransactionsNewestFirst", () => {
  it("returns transactions newest first without mutating the source array", () => {
    const oldest = tx("oldest", "2026-04-27T09:00:00.000Z");
    const newest = tx("newest", "2026-04-27T11:00:00.000Z");
    const middle = tx("middle", "2026-04-27T10:00:00.000Z");
    const source = [oldest, newest, middle];

    expect(sortTransactionsNewestFirst(source).map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
    expect(source.map((item) => item.id)).toEqual(["oldest", "newest", "middle"]);
  });
});
