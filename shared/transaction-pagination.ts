/**
 * Pagination for GET /agent/transactions (#1302).
 *
 * Handler cost and response size scale with the page returned, not with the
 * total history, as long as the page size is bounded. Before this cap a client
 * could pass `?limit=<huge>` and serialise the entire history in one response;
 * see docs/performance/agent-transactions-1302.md for the measurements.
 */

export const DEFAULT_TRANSACTIONS_LIMIT = 25;
/** Largest page a single request may return. Larger `limit`s are clamped. */
export const MAX_TRANSACTIONS_LIMIT = 500;

export interface TransactionsPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

function parseNonNegativeInt(raw: unknown, fallback: number): number {
  const parsed = parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : fallback;
}

/**
 * Newest-first page of `transactions` (stored oldest-first) for the raw
 * `limit`/`offset` query values. `limit` defaults to 25 and is clamped to
 * [0, MAX_TRANSACTIONS_LIMIT] (`limit=0` intentionally returns an empty page,
 * #1073); `offset` defaults to 0 and is clamped to >= 0.
 */
export function paginateTransactions<T>(
  transactions: readonly T[],
  rawLimit: unknown,
  rawOffset: unknown,
): { transactions: T[]; pagination: TransactionsPagination } {
  const limit = Math.min(
    parseNonNegativeInt(rawLimit, DEFAULT_TRANSACTIONS_LIMIT),
    MAX_TRANSACTIONS_LIMIT,
  );
  const offset = parseNonNegativeInt(rawOffset, 0);
  const total = transactions.length;
  // Compute clamped indices explicitly rather than relying on slice()'s
  // negative-index handling, which treats -0 (e.g. offset=0, limit=0) as
  // literal index 0 instead of "end of array" and silently returns
  // everything instead of nothing.
  const end = Math.max(total - offset, 0);
  const start = Math.max(end - limit, 0);
  return {
    transactions: transactions.slice(start, end).reverse(),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
      hasPrevious: offset > 0,
    },
  };
}
