import { describe, it, expect } from "vitest";
import { adherenceTimeline, type AdherenceRecord } from "../adherence.ts";

function record(overrides: Partial<AdherenceRecord>): AdherenceRecord {
  return {
    id: "adh-1",
    recipientId: "rosa",
    drug: "Lisinopril",
    pharmacy: "CVS",
    orderId: "o-1",
    daysSupply: 30,
    orderedAt: "2026-02-01T00:00:00.000Z",
    dueDate: "2026-03-01T00:00:00.000Z",
    status: "pending",
    skippedCount: 0,
    ...overrides,
  };
}

describe("adherenceTimeline (#1237)", () => {
  it("dates resolved doses by when they were recorded and pending ones by due date", () => {
    const events = adherenceTimeline(
      [
        record({ id: "a", status: "confirmed", confirmedAt: "2026-03-05T00:00:00.000Z" }),
        record({ id: "b", status: "pending", dueDate: "2026-03-02T00:00:00.000Z" }),
        record({ id: "c", status: "skipped", confirmedAt: "2026-03-03T00:00:00.000Z" }),
        record({ id: "other", recipientId: "someone-else" }),
      ],
      "rosa",
    );
    expect(events.map((e) => [e.id, e.date])).toEqual([
      ["b", "2026-03-02T00:00:00.000Z"],
      ["c", "2026-03-03T00:00:00.000Z"],
      ["a", "2026-03-05T00:00:00.000Z"],
    ]);
  });

  it("drops records with unparseable dates", () => {
    expect(adherenceTimeline([record({ dueDate: "not-a-date" })], "rosa")).toEqual([]);
  });
});
