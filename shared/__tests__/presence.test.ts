import { describe, it, expect, beforeEach } from "vitest";
import {
  recordItemView,
  loadPresenceMap,
  savePresenceMap,
  getItemPresence,
  PRESENCE_TTL_MS,
} from "../presence.ts";

describe("Co-Caregiver Presence & Last-Viewed Indicators (Issue #1231)", () => {
  const testRecipient = "test-presence-recipient";

  beforeEach(() => {
    savePresenceMap({}, testRecipient);
  });

  it("records an item view for a caregiver", () => {
    const entry = recordItemView({
      itemId: "tx-approval-101",
      itemType: "approval",
      caregiverId: "caregiver-david",
      caregiverName: "David Garcia",
      recipientId: testRecipient,
    });

    expect(entry.caregiverName).toBe("David Garcia");
    expect(entry.lastViewedAt).toBeDefined();

    const viewers = getItemPresence("tx-approval-101", testRecipient);
    expect(viewers.length).toBe(1);
    expect(viewers[0].caregiverName).toBe("David Garcia");
  });

  it("updates existing caregiver timestamp when they view the item again", () => {
    recordItemView({
      itemId: "bill-202",
      itemType: "bill",
      caregiverId: "caregiver-maria",
      caregiverName: "Maria Garcia",
      recipientId: testRecipient,
    });

    recordItemView({
      itemId: "bill-202",
      itemType: "bill",
      caregiverId: "caregiver-maria",
      caregiverName: "Maria Garcia",
      recipientId: testRecipient,
    });

    const viewers = getItemPresence("bill-202", testRecipient);
    expect(viewers.length).toBe(1);
  });

  it("tracks multiple co-caregivers viewing the same item", () => {
    recordItemView({
      itemId: "bill-303",
      itemType: "bill",
      caregiverId: "caregiver-maria",
      caregiverName: "Maria Garcia",
      recipientId: testRecipient,
    });

    recordItemView({
      itemId: "bill-303",
      itemType: "bill",
      caregiverId: "caregiver-david",
      caregiverName: "David Garcia",
      recipientId: testRecipient,
    });

    const viewers = getItemPresence("bill-303", testRecipient);
    expect(viewers.length).toBe(2);
    expect(viewers.some((v) => v.caregiverName === "Maria Garcia")).toBe(true);
    expect(viewers.some((v) => v.caregiverName === "David Garcia")).toBe(true);
  });

  it("prunes expired presence entries older than 24 hours", () => {
    const expiredTimestamp = new Date(Date.now() - (PRESENCE_TTL_MS + 10000)).toISOString();
    const freshTimestamp = new Date().toISOString();

    const rawMap = {
      "item-expired": [
        {
          caregiverId: "caregiver-old",
          caregiverName: "Old Caregiver",
          lastViewedAt: expiredTimestamp,
        },
      ],
      "item-fresh": [
        {
          caregiverId: "caregiver-new",
          caregiverName: "New Caregiver",
          lastViewedAt: freshTimestamp,
        },
      ],
    };

    savePresenceMap(rawMap as any, testRecipient);

    const loaded = loadPresenceMap(testRecipient);
    expect(loaded["item-expired"]).toBeUndefined();
    expect(loaded["item-fresh"]).toBeDefined();
    expect(loaded["item-fresh"].length).toBe(1);
  });
});
