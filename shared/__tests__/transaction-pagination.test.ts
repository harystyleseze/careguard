import { describe, expect, it } from "vitest";
import {
  paginateTransactionsNewestFirst,
  sortTransactionsNewestFirst,
} from "../transaction-pagination";

const transactions = [
  { id: "oldest", timestamp: "2026-04-27T09:00:00.000Z" },
  { id: "newest", timestamp: "2026-04-27T11:00:00.000Z" },
  { id: "middle", timestamp: "2026-04-27T10:00:00.000Z" },
];

describe("transaction pagination", () => {
  it("sorts newest first without mutating the source list", () => {
    expect(sortTransactionsNewestFirst(transactions).map((tx) => tx.id)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
    expect(transactions.map((tx) => tx.id)).toEqual([
      "oldest",
      "newest",
      "middle",
    ]);
  });

  it("paginates after sorting by timestamp descending", () => {
    expect(
      paginateTransactionsNewestFirst(transactions, 2, 1).map((tx) => tx.id),
    ).toEqual(["middle", "oldest"]);
  });
});
