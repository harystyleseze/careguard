import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSACTIONS_LIMIT,
  MAX_TRANSACTIONS_LIMIT,
  paginateTransactions,
} from "../transaction-pagination.ts";

// Stored oldest-first, like the spending tracker.
const history = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginateTransactions (#1302)", () => {
  it("defaults to the newest 25 when limit/offset are absent or invalid", () => {
    for (const [limit, offset] of [[undefined, undefined], ["abc", "xyz"]]) {
      const { transactions, pagination } = paginateTransactions(history(100), limit, offset);
      expect(transactions).toHaveLength(DEFAULT_TRANSACTIONS_LIMIT);
      expect(transactions[0]).toBe(99);
      expect(pagination).toEqual({ total: 100, limit: 25, offset: 0, hasMore: true, hasPrevious: false });
    }
  });

  it("clamps limit to MAX_TRANSACTIONS_LIMIT", () => {
    const { transactions, pagination } = paginateTransactions(history(10_000), "100000", "0");
    expect(transactions).toHaveLength(MAX_TRANSACTIONS_LIMIT);
    expect(pagination.limit).toBe(MAX_TRANSACTIONS_LIMIT);
    expect(pagination.hasMore).toBe(true);
  });

  it("keeps limit=0 as an empty page (#1073)", () => {
    const { transactions, pagination } = paginateTransactions(history(10), "0", "0");
    expect(transactions).toEqual([]);
    expect(pagination.limit).toBe(0);
  });

  it("clamps negative limit and offset to 0", () => {
    const { transactions, pagination } = paginateTransactions(history(10), "-5", "-3");
    expect(transactions).toEqual([]);
    expect(pagination).toMatchObject({ limit: 0, offset: 0, hasPrevious: false });
  });

  it("walks the full history newest-first in max-size pages", () => {
    const all = history(1_234);
    const seen: number[] = [];
    for (let offset = 0; ; offset += MAX_TRANSACTIONS_LIMIT) {
      const page = paginateTransactions(all, MAX_TRANSACTIONS_LIMIT, offset);
      seen.push(...page.transactions);
      if (!page.pagination.hasMore) break;
    }
    expect(seen).toEqual(all.slice().reverse());
  });

  it("returns an empty page past the end", () => {
    const { transactions, pagination } = paginateTransactions(history(10), "5", "50");
    expect(transactions).toEqual([]);
    expect(pagination).toMatchObject({ hasMore: false, hasPrevious: true });
  });
});
