export interface TimestampedTransaction {
  timestamp: string;
}

export function sortTransactionsNewestFirst<T extends TimestampedTransaction>(
  transactions: T[],
) {
  return [...transactions].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  );
}

export function paginateTransactionsNewestFirst<T extends TimestampedTransaction>(
  transactions: T[],
  limit: number,
  offset: number,
) {
  return sortTransactionsNewestFirst(transactions).slice(offset, offset + limit);
}
