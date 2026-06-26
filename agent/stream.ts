export interface AgentStreamStatus {
  paused: boolean;
  pausedReason?: string | null;
  pausedAt?: string | null;
}

export interface AgentStreamPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

export interface AgentStreamSnapshot {
  agent: AgentStreamStatus;
  spending: unknown;
  transactions: unknown[];
  pagination: AgentStreamPagination;
}

export interface AgentStreamSnapshotInput {
  agent: AgentStreamStatus;
  spending: unknown;
  tracker: {
    transactions?: unknown[];
  };
  limit?: unknown;
  offset?: unknown;
}

function coerceBoundedInteger(
  value: unknown,
  fallback: number,
  options: { min: number; max: number },
): number {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(options.max, Math.max(options.min, Math.floor(parsed)));
}

export function createAgentStreamSnapshot({
  agent,
  spending,
  tracker,
  limit,
  offset,
}: AgentStreamSnapshotInput): AgentStreamSnapshot {
  const transactions = Array.isArray(tracker.transactions)
    ? tracker.transactions
    : [];
  const pageLimit = coerceBoundedInteger(limit, 25, { min: 1, max: 100 });
  const pageOffset = coerceBoundedInteger(offset, 0, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  });
  const pagedTransactions = transactions.slice(
    pageOffset,
    pageOffset + pageLimit,
  );

  return {
    agent,
    spending,
    transactions: pagedTransactions,
    pagination: {
      total: transactions.length,
      limit: pageLimit,
      offset: pageOffset,
      hasMore: pageOffset + pageLimit < transactions.length,
      hasPrevious: pageOffset > 0,
    },
  };
}

export function createAgentStreamSignature(
  snapshot: AgentStreamSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function formatSseRetry(milliseconds: number): string {
  const retryMs = coerceBoundedInteger(milliseconds, 3000, {
    min: 1000,
    max: 30000,
  });
  return `retry: ${retryMs}\n\n`;
}
