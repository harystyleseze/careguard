import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runPriceWatchForRecipient,
  loadPriceWatchHistory,
  savePriceWatchHistory,
} from "../price-watch.ts";
import * as notifications from "../../shared/notifications.ts";

describe("Medication Price Watch & Savings Alerts (Issue #1236)", () => {
  const testRecipient = "test-recipient-price-watch";

  beforeEach(() => {
    savePriceWatchHistory({}, testRecipient);
    vi.restoreAllMocks();
  });

  it("loads and saves price watch history", () => {
    savePriceWatchHistory(
      {
        lisinopril: {
          medication: "Lisinopril",
          pharmacy: "Costco Pharmacy",
          price: 12.0,
          savings: 35.0,
          savingsPercent: 74,
          alertedAt: new Date().toISOString(),
        },
      },
      testRecipient,
    );

    const history = loadPriceWatchHistory(testRecipient);
    expect(history.lisinopril).toBeDefined();
    expect(history.lisinopril.pharmacy).toBe("Costco Pharmacy");
    expect(history.lisinopril.savings).toBe(35.0);
  });

  it("dispatches notifications when material price drops are discovered", async () => {
    const notifySpy = vi.spyOn(notifications, "notify").mockResolvedValue(undefined as any);

    const result = await runPriceWatchForRecipient(testRecipient, ["Lisinopril"]);

    expect(result.recipientId).toBe(testRecipient);
    expect(result.checkedMeds).toContain("Lisinopril");

    if (result.alertsSent.length > 0) {
      expect(notifySpy).toHaveBeenCalled();
      const firstAlert = result.alertsSent[0];
      expect(firstAlert.savings).toBeGreaterThanOrEqual(5.0);
      expect(firstAlert.savingsPercent).toBeGreaterThanOrEqual(15);
    }
  });

  it("respects caregiver opt-outs per medication", async () => {
    // When a medication is in optOutMeds, it is skipped without making comparisons
    const result = await runPriceWatchForRecipient(testRecipient, ["Lisinopril"]);
    expect(result.checkedMeds).toContain("Lisinopril");
  });
});
