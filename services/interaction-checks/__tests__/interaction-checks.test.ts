/**
 * Persisted drug interaction check history (#1193).
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  InteractionCheckStore,
  recordInteractionCheck,
  summarizeResult,
} from "../db.ts";
import { createInteractionChecksRouter } from "../routes.ts";

const RESULT = {
  checkTimestamp: "2026-10-01T10:00:00.000Z",
  interactions: [
    { drugs: ["Warfarin", "Aspirin"], severity: "moderate" },
    { drugs: ["Warfarin", "Ibuprofen"], severity: "major" },
  ],
  summary: "2 interactions found",
};

describe("InteractionCheckStore (#1193)", () => {
  let store: InteractionCheckStore;
  beforeEach(() => {
    store = new InteractionCheckStore(":memory:");
  });

  it("records a check with recipient, drugs, result and timestamp", () => {
    const saved = recordInteractionCheck("rosa", ["Warfarin", "Aspirin", "Ibuprofen"], RESULT, store);
    expect(saved).not.toBeNull();
    const [row] = store.list("rosa");
    expect(row.recipient_id).toBe("rosa");
    expect(row.medications).toEqual(["Warfarin", "Aspirin", "Ibuprofen"]);
    expect(row.interaction_count).toBe(2);
    expect(row.highest_severity).toBe("major");
    expect(row.summary).toBe("2 interactions found");
    expect(row.interactions).toHaveLength(2);
    expect(row.checked_at).toBe("2026-10-01T10:00:00.000Z");
  });

  it("skips failed checks", () => {
    expect(recordInteractionCheck("rosa", ["Warfarin"], { ok: false, reason: "NEED_AT_LEAST_TWO_MEDS" }, store)).toBeNull();
    expect(recordInteractionCheck("rosa", ["A", "B"], null, store)).toBeNull();
    expect(store.list("rosa")).toHaveLength(0);
  });

  it("filters by drug name, case-insensitively, and scopes by recipient", () => {
    recordInteractionCheck("rosa", ["Warfarin", "Aspirin"], { ...RESULT, checkTimestamp: "2026-10-01T10:00:00.000Z" }, store);
    recordInteractionCheck("rosa", ["Lisinopril", "Metformin"], { interactions: [], summary: "none", checkTimestamp: "2026-10-02T10:00:00.000Z" }, store);
    recordInteractionCheck("other", ["Warfarin", "Aspirin"], RESULT, store);

    expect(store.list("rosa").map((c) => c.medications[0])).toEqual(["Lisinopril", "Warfarin"]); // newest first
    expect(store.list("rosa", { drug: "warfarin" })).toHaveLength(1);
    expect(store.list("rosa", { drug: "METF" })[0].medications).toContain("Metformin");
    expect(store.list("rosa", { drug: "%" })).toHaveLength(0); // LIKE wildcards are escaped
    expect(store.list("other")).toHaveLength(1);
  });

  it("prunes entries older than the retention window", () => {
    const now = new Date("2026-10-17T00:00:00.000Z");
    store.record({ recipient_id: "rosa", medications: ["A", "B"], checked_at: "2025-01-01T00:00:00.000Z", ...summarizeResult({}) }, now);
    store.record({ recipient_id: "rosa", medications: ["C", "D"], checked_at: "2026-10-16T00:00:00.000Z", ...summarizeResult({}) }, now);
    expect(store.list("rosa").map((c) => c.medications[0])).toEqual(["C"]);
    expect(store.prune(now, 1)).toBe(0);
  });
});

describe("GET /agent/interaction-checks (#1193)", () => {
  it("returns the recipient's history, filterable by drug", async () => {
    const store = new InteractionCheckStore(":memory:");
    recordInteractionCheck("rosa", ["Warfarin", "Aspirin"], RESULT, store);
    recordInteractionCheck("rosa", ["Lisinopril", "Metformin"], { interactions: [], checkTimestamp: "2026-10-02T10:00:00.000Z" }, store);
    const app = express().use("/agent", createInteractionChecksRouter(store));

    const all = await request(app).get("/agent/interaction-checks?recipient_id=rosa");
    expect(all.status).toBe(200);
    expect(all.body.recipientId).toBe("rosa");
    expect(all.body.checks).toHaveLength(2);

    const filtered = await request(app).get("/agent/interaction-checks?recipient_id=rosa&drug=aspirin");
    expect(filtered.body.checks).toHaveLength(1);
    expect(filtered.body.checks[0].medications).toEqual(["Warfarin", "Aspirin"]);
  });
});
