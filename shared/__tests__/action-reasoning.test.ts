/**
 * Plain-language reasoning traces for agent actions (#1235).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { rmSync } from "fs";
import { buildActionReasonings, describeToolCall } from "../action-reasoning.ts";
import { listActionReasoning, MAX_ACTION_REASONING_ENTRIES, recordActionReasoning } from "../agent-state.ts";

const policy = { approvalThreshold: 75, dailyLimit: 100, billMonthlyBudget: 500 };

const audit = {
  id: "call-1",
  tool: "fetch_and_audit_bill",
  input: {},
  result: {
    totalCharged: 300,
    totalOvercharge: 50,
    totalCorrect: 250,
    errorCount: 1,
    lineItems: [{ description: "CBC panel", status: "flagged", errorDescription: "Duplicate charge" }],
    recommendation: "Dispute before paying.",
  },
};

const pendingBill = {
  id: "call-2",
  tool: "pay_bill",
  input: { provider_name: "General Hospital", amount: 250 },
  result: {
    success: false,
    error: "REQUIRES CAREGIVER APPROVAL: 250.00 exceeds the 75 approval threshold.",
    transaction: { id: "tx-1", status: "pending", amount: 250 },
  },
};

describe("buildActionReasonings", () => {
  it("explains a held payment with the tools that ran before it and the key numbers", () => {
    const [, payment] = buildActionReasonings({ runId: "run-1", toolCalls: [audit, pendingBill], policy });
    expect(payment).toMatchObject({
      kind: "payment_pending_approval",
      title: "Bill payment held for approval",
      transactionId: "tx-1",
      toolCallId: "call-2",
    });
    expect(payment.outcome).toBe(
      "Held the $250.00 bill from General Hospital for a caregiver's approval instead of paying it: 250.00 exceeds the 75 approval threshold.",
    );
    expect(payment.steps.map((s) => s.tool)).toEqual(["fetch_and_audit_bill", "pay_bill"]);
    expect(payment.steps[0].summary).toMatch(/found 1 error worth \$50\.00/);
    expect(payment.dataPoints).toEqual(
      expect.arrayContaining([
        { label: "Amount", value: "$250.00" },
        { label: "Approval threshold", value: "$75.00" },
      ]),
    );
  });

  it("stores plain language, never raw tool JSON", () => {
    const entries = buildActionReasonings({ runId: "run-1", toolCalls: [audit, pendingBill], policy });
    for (const entry of entries) {
      for (const text of [entry.outcome, ...entry.steps.map((s) => s.summary)]) {
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });

  it("explains a policy block and a flagged interaction", () => {
    const entries = buildActionReasonings({
      runId: "run-2",
      toolCalls: [
        {
          tool: "check_drug_interactions",
          input: { medications: ["lisinopril", "potassium"] },
          result: {
            interactions: [{ drugs: ["lisinopril", "potassium"], severity: "severe", description: "Hyperkalemia risk" }],
            decision: "block",
            blockingThreshold: "major",
          },
        },
        {
          tool: "pay_for_medication",
          input: { drug_name: "Lisinopril", pharmacy_name: "CVS", amount: 120 },
          result: { success: false, error: "BLOCKED BY SPENDING POLICY: Daily limit of $100 reached", transaction: { id: "tx-2", status: "blocked" } },
        },
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual(["interaction_flagged", "payment_blocked"]);
    expect(entries[0].dataPoints[0]).toEqual({ label: "lisinopril + potassium", value: "severe — Hyperkalemia risk" });
    expect(entries[1].outcome).toMatch(/spending policy blocked it: Daily limit of \$100 reached\. No money moved\./);
  });

  it("skips routine tool calls", () => {
    const entries = buildActionReasonings({
      runId: "run-3",
      toolCalls: [
        { tool: "get_spending_summary", input: {}, result: { spending: { total: 10, medications: 5, bills: 5 } } },
        { tool: "check_drug_interactions", input: { medications: ["a", "b"] }, result: { interactions: [] } },
      ],
    });
    expect(entries).toEqual([]);
  });

  it("redacts patient names, medication doses and secrets via shared/redact.ts", () => {
    const [entry] = buildActionReasonings({
      runId: "run-4",
      toolCalls: [
        {
          tool: "pay_for_medication",
          input: { drug_name: "Lisinopril 10mg", pharmacy_name: "Rosa Garcia's pharmacy", amount: 5 },
          result: { success: true, transaction: { id: "tx-3", status: "completed" } },
        },
      ],
    });
    expect(entry.outcome).toContain("[MEDICATION]");
    expect(entry.outcome).toContain("[PATIENT NAME]");
    expect(entry.outcome).not.toMatch(/Rosa Garcia|10mg/);
  });
});

describe("describeToolCall", () => {
  it("falls back to a readable sentence for unknown tools and errors", () => {
    expect(describeToolCall({ tool: "get_handoff_notes", input: {}, result: {} })).toBe("Read caregiver handoff notes.");
    expect(describeToolCall({ tool: "get_wallet_balance", input: {}, result: { error: "Horizon down" } })).toBe(
      "Checked the wallet balance, but it failed: Horizon down.",
    );
  });
});

describe("reasoning persistence (shared/agent-state.ts)", () => {
  beforeEach(() => {
    rmSync(`${process.env.DATA_DIR}/action-reasoning.json`, { force: true });
  });

  it("returns newest first and filters by transaction", () => {
    const entries = buildActionReasonings({ runId: "run-5", toolCalls: [audit, pendingBill], policy });
    recordActionReasoning(entries);
    const listed = listActionReasoning();
    expect(listed.map((e) => e.toolCallId)).toEqual(["call-2", "call-1"]);
    expect(listActionReasoning({ transactionId: "tx-1" })).toHaveLength(1);
    expect(listActionReasoning({ toolCallId: "call-1" })[0].kind).toBe("bill_audit_flagged");
  });

  it("keeps only the most recent entries", () => {
    const [template] = buildActionReasonings({ runId: "r", toolCalls: [pendingBill], policy });
    recordActionReasoning(
      Array.from({ length: MAX_ACTION_REASONING_ENTRIES + 5 }, (_, i) => ({ ...template, id: `e-${i}` })),
    );
    const listed = listActionReasoning({ limit: MAX_ACTION_REASONING_ENTRIES });
    expect(listed).toHaveLength(MAX_ACTION_REASONING_ENTRIES);
    expect(listed[0].id).toBe(`e-${MAX_ACTION_REASONING_ENTRIES + 4}`);
  });
});
