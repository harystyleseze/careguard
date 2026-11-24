/**
 * Persisted agent tool invocation history.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { AgentHistoryStore, describeOutcome, recordAgentToolCall } from "../db.ts";
import { createAgentHistoryRouter } from "../routes.ts";

const SECRET_SEED = `S${"A".repeat(55)}`;
const TX_HASH = "a".repeat(64);

function seed(store: AgentHistoryStore) {
  recordAgentToolCall(
    {
      recipientId: "rosa",
      runId: "run-1",
      task: "Pay Rosa Garcia's bill",
      tool: "pay_bill",
      input: { provider_id: "p1", amount: 120, memo: `seed ${SECRET_SEED}` },
      result: {
        success: true,
        transaction: { id: "tx-1", description: "ER visit", amount: 120, status: "completed", stellarTxHash: TX_HASH },
      },
      at: "2026-10-01T10:00:00.000Z",
    },
    store,
  );
  recordAgentToolCall(
    {
      recipientId: "rosa",
      runId: "run-2",
      task: "Audit the latest bill",
      tool: "fetch_and_audit_bill",
      input: {},
      result: { errorCount: 2, totalOvercharge: 45.5, lineItems: [] },
      at: "2026-10-05T10:00:00.000Z",
    },
    store,
  );
  recordAgentToolCall(
    {
      recipientId: "rosa",
      runId: "run-2",
      task: "Audit the latest bill",
      tool: "generate_dispute_letter",
      input: { bill_id: "b-9" },
      result: { disputeRecord: { id: "dispute_1", billId: "b-9", totalOvercharge: 45.5 } },
      at: "2026-10-05T10:01:00.000Z",
    },
    store,
  );
  recordAgentToolCall(
    { recipientId: "other", tool: "pay_bill", input: {}, result: { error: "boom" }, at: "2026-10-06T10:00:00.000Z" },
    store,
  );
}

describe("AgentHistoryStore", () => {
  let store: AgentHistoryStore;
  beforeEach(() => {
    store = new AgentHistoryStore(":memory:");
    seed(store);
  });

  it("lists a recipient's invocations newest first with outcome and links", () => {
    const { entries, pagination } = store.list("rosa");
    expect(entries.map((e) => e.tool)).toEqual(["generate_dispute_letter", "fetch_and_audit_bill", "pay_bill"]);
    expect(pagination).toMatchObject({ total: 3, offset: 0, hasMore: false, hasPrevious: false });

    const pay = entries[2];
    expect(pay.status).toBe("success");
    expect(pay.summary).toBe("Paid $120.00 — ER visit");
    expect(pay.links).toEqual([
      { kind: "transaction", id: "tx-1", label: "ER visit · $120.00", stellarTxHash: TX_HASH },
    ]);
    expect(entries[0].links[0]).toMatchObject({ kind: "dispute", id: "dispute_1" });
    expect(entries[1].links[0]).toMatchObject({ kind: "bill_audit" });
    expect(entries[1].summary).toBe("Audit found 2 errors, $45.50 overcharge");
  });

  it("redacts secrets on write and PII on read", () => {
    const pay = store.list("rosa", { tool: "pay_bill" }).entries[0];
    expect(JSON.stringify(pay)).not.toContain(SECRET_SEED);
    expect(pay.input.memo).toBe("seed [REDACTED]");
    expect(pay.task).toBe("Pay [PATIENT NAME]'s bill");
  });

  it("filters by tool name and date range, scoped by recipient", () => {
    expect(store.list("rosa", { tool: "AUDIT" }).entries.map((e) => e.tool)).toEqual(["fetch_and_audit_bill"]);
    expect(store.list("rosa", { tool: "%" }).entries).toHaveLength(0); // LIKE wildcards are escaped
    expect(store.list("rosa", { from: "2026-10-02" }).entries).toHaveLength(2);
    expect(store.list("rosa", { to: "2026-10-01" }).entries.map((e) => e.tool)).toEqual(["pay_bill"]);
    expect(store.list("rosa", { from: "2026-10-05", to: "2026-10-05" }).entries).toHaveLength(2);
    expect(store.list("other").entries[0].status).toBe("error");
    expect(store.tools("rosa")).toEqual(["fetch_and_audit_bill", "generate_dispute_letter", "pay_bill"]);
  });

  it("paginates long histories", () => {
    const first = store.list("rosa", { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.pagination).toMatchObject({ total: 3, limit: 2, hasMore: true, hasPrevious: false });
    const second = store.list("rosa", { limit: 2, offset: 2 });
    expect(second.entries.map((e) => e.tool)).toEqual(["pay_bill"]);
    expect(second.pagination).toMatchObject({ hasMore: false, hasPrevious: true });
    expect(store.list("rosa", { limit: 10_000 }).pagination.limit).toBe(200);
  });

  it("prunes entries older than the retention window", () => {
    expect(store.prune(new Date("2026-10-06T00:00:00.000Z"), 3)).toBe(1);
    expect(store.list("rosa").entries.map((e) => e.tool)).not.toContain("pay_bill");
  });
});

describe("describeOutcome", () => {
  it("classifies pending and blocked payments", () => {
    const pending = describeOutcome("pay_for_medication", {
      ok: false,
      status: "pending",
      transaction: { id: "tx-2", description: "Lisinopril", amount: 300, status: "pending" },
    });
    expect(pending.status).toBe("pending");
    expect(pending.links[0].kind).toBe("approval");

    const blocked = describeOutcome("pay_bill", {
      ok: false,
      status: "blocked",
      transaction: { id: "tx-3", description: "Bill", amount: 900, status: "blocked" },
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.summary).toMatch(/^Blocked \$900\.00/);
  });

  it("records failures with their error message", () => {
    expect(describeOutcome("pay_bill", { error: "Horizon down" })).toMatchObject({
      status: "error",
      error: "Horizon down",
      summary: "Failed: Horizon down",
    });
  });
});

describe("GET /agent/history", () => {
  it("returns a filtered, paginated page and the tool list", async () => {
    const store = new AgentHistoryStore(":memory:");
    seed(store);
    const app = express().use("/agent", createAgentHistoryRouter(store));

    const res = await request(app).get("/agent/history?recipient_id=rosa&tool=pay&limit=1");
    expect(res.status).toBe(200);
    expect(res.body.recipientId).toBe("rosa");
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].tool).toBe("pay_bill");
    expect(res.body.pagination.total).toBe(1);

    const tools = await request(app).get("/agent/history/tools?recipient_id=rosa");
    expect(tools.body.tools).toContain("generate_dispute_letter");
  });
});
