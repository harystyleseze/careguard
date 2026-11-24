import { describe, expect, it } from "vitest";
import { summarizeAdherenceRecords, type AdherenceRecord } from "../adherence.ts";

function record(id: string, status: AdherenceRecord["status"], dueDate: string): AdherenceRecord {
  return {
    id,
    recipientId: "rosa",
    drug: "lisinopril",
    pharmacy: "test",
    orderId: `order-${id}`,
    daysSupply: 30,
    orderedAt: "2026-01-01T00:00:00Z",
    dueDate,
    status,
    skippedCount: status === "flagged" ? 3 : 0,
  };
}

describe("summarizeAdherenceRecords", () => {
  it("computes all counters and reminder lists in one pass", () => {
    const records = [
      record("confirmed", "confirmed", "2026-01-01T00:00:00Z"),
      record("pending-due", "pending", "2026-01-02T00:00:00Z"),
      record("pending-future", "pending", "2027-01-01T00:00:00Z"),
      record("flagged", "flagged", "2026-01-01T00:00:00Z"),
      { ...record("other", "confirmed", "2026-01-01T00:00:00Z"), recipientId: "other" },
    ];
    const result = summarizeAdherenceRecords(records, "rosa", new Date("2026-06-01T00:00:00Z"));
    expect(result).toMatchObject({ total: 4, confirmed: 1, pending: 2, flagged: 1, adherenceRate: 25 });
    expect(result.pendingNow.map((item) => item.id)).toEqual(["pending-due"]);
    expect(result.flaggedRecords.map((item) => item.id)).toEqual(["flagged"]);
  });
});
