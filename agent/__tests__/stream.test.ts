import { describe, expect, it } from "vitest";
import {
  createAgentStreamSignature,
  createAgentStreamSnapshot,
  formatSseEvent,
  formatSseRetry,
} from "../stream.ts";

const spending = {
  policy: {
    dailyLimit: 100,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
  },
  spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
  budgetRemaining: { medications: 300, bills: 500 },
  transactionCount: 3,
  recentTransactions: [],
};

describe("agent stream helpers", () => {
  it("builds a paginated snapshot with agent status, spending, and transactions", () => {
    const snapshot = createAgentStreamSnapshot({
      agent: { paused: false },
      spending,
      tracker: {
        transactions: [
          { id: "tx-1" },
          { id: "tx-2" },
          { id: "tx-3" },
        ],
      },
      limit: "2",
      offset: "1",
    });

    expect(snapshot.agent.paused).toBe(false);
    expect(snapshot.spending).toBe(spending);
    expect(snapshot.transactions).toEqual([{ id: "tx-2" }, { id: "tx-3" }]);
    expect(snapshot.pagination).toEqual({
      total: 3,
      limit: 2,
      offset: 1,
      hasMore: false,
      hasPrevious: true,
    });
  });

  it("formats retry and named SSE events", () => {
    expect(formatSseRetry(3000)).toBe("retry: 3000\n\n");
    expect(formatSseEvent("snapshot", { ok: true })).toBe(
      'event: snapshot\ndata: {"ok":true}\n\n',
    );
  });

  it("changes signatures when streamed state changes", () => {
    const active = createAgentStreamSnapshot({
      agent: { paused: false },
      spending,
      tracker: { transactions: [] },
    });
    const paused = createAgentStreamSnapshot({
      agent: { paused: true },
      spending,
      tracker: { transactions: [] },
    });

    expect(createAgentStreamSignature(active)).not.toEqual(
      createAgentStreamSignature(paused),
    );
  });
});
