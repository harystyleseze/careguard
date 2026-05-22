import type { Transaction } from "./types";

export function sortTransactionsNewestFirst(transactions: Transaction[]) {
  return [...transactions].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  );
}
