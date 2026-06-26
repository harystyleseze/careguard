import { describe, expect, it } from "vitest";
import { AgentStreamSnapshotSchema } from "../lib/types";

const transaction = {
  id: "tx-1",
  timestamp: "2026-06-26T00:00:00.000Z",
  type: "medication",
  description: "Medication order",
  amount: 12.5,
  recipient: "rosa",
  status: "completed",
  category: "medications",
};

const spending = {
  policy: {
    dailyLimit: 100,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
  },
  spending: { medications: 12.5, bills: 0, serviceFees: 0, total: 12.5 },
  budgetRemaining: { medications: 287.5, bills: 500 },
  transactionCount: 1,
  recentTransactions: [transaction],
};

describe("AgentStreamSnapshotSchema", () => {
  it("accepts the SSE snapshot shape used by the dashboard", () => {
    const parsed = AgentStreamSnapshotSchema.parse({
      agent: { paused: false },
      spending,
      transactions: [transaction],
      pagination: {
        total: 1,
        limit: 25,
        offset: 0,
        hasMore: false,
        hasPrevious: false,
      },
    });

    expect(parsed.agent.paused).toBe(false);
    expect(parsed.transactions).toHaveLength(1);
  });

  it("rejects snapshots without pagination metadata", () => {
    expect(() =>
      AgentStreamSnapshotSchema.parse({
        agent: { paused: false },
        spending,
        transactions: [transaction],
      }),
    ).toThrow();
  });
});
