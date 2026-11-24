import { describe, it, expect, beforeEach } from "vitest";
import {
  ProviderBillHistoryStore,
  normalizeProviderId,
} from "../history.ts";
import { auditBill } from "../../../shared/bill-audit.ts";

describe("Issue #1217: Compare Billed Amounts Against Historical Charges from Same Provider", () => {
  let store: ProviderBillHistoryStore;

  beforeEach(() => {
    store = new ProviderBillHistoryStore(":memory:");
  });

  describe("Provider Bill History Store & Normalization", () => {
    it("normalizes provider identifiers uniformly", () => {
      expect(normalizeProviderId("St. Jude's Medical Center - North")).toBe(
        "st-jude-s-medical-center-north"
      );
      expect(normalizeProviderId("  CVS Health / Pharmacy #104  ")).toBe(
        "cvs-health-pharmacy-104"
      );
      expect(normalizeProviderId("already-normalized-123")).toBe(
        "already-normalized-123"
      );
    });

    it("seeds default historical baseline records upon initialization", () => {
      // By default, seeded baseline includes General Hospital
      const history = store.getHistoryForCpt("General Hospital", "99233");
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].cptCode).toBe("99233");
      expect(history[0].chargedAmount).toBeGreaterThan(0);
    });

    it("records new charges and queries them by provider and cpt code", () => {
      const provider = "cedars-sinai";
      store.recordCharge({
        providerId: provider,
        providerName: "Cedars-Sinai Medical Center",
        cptCode: "99285",
        description: "Emergency Dept Visit - High Severity",
        chargedAmount: 1200.0,
        dateOfService: "2026-01-10",
      });

      store.recordCharge({
        providerId: provider,
        providerName: "Cedars-Sinai Medical Center",
        cptCode: "99285",
        description: "Emergency Dept Visit - High Severity",
        chargedAmount: 1300.0,
        dateOfService: "2026-04-15",
      });

      const history = store.getHistoryForCpt(provider, "99285");
      expect(history).toHaveLength(2);
      expect(history[0].chargedAmount).toBe(1200.0);
      expect(history[1].chargedAmount).toBe(1300.0);
    });
  });

  describe("Historical Charge Comparison Algorithm", () => {
    it("returns null (graceful fallback) when no history exists for provider/cpt", () => {
      const comparison = store.compareAgainstHistory(
        "unknown-clinic",
        "99999",
        500.0
      );
      expect(comparison).toBeNull();
    });

    it("flags material increase when billed amount is >= 15% above historical average", () => {
      const provider = "bay-clinic";
      // Record 3 prior charges at average $100.00
      store.recordCharge({
        providerId: provider,
        cptCode: "99213",
        chargedAmount: 95.0,
        dateOfService: "2025-06-01",
      });
      store.recordCharge({
        providerId: provider,
        cptCode: "99213",
        chargedAmount: 105.0,
        dateOfService: "2025-09-01",
      });
      store.recordCharge({
        providerId: provider,
        cptCode: "99213",
        chargedAmount: 100.0,
        dateOfService: "2025-12-01",
      });
      // Historical average: 100.00

      // Case 1: Candidate is $108 (+8% increase, below 15% threshold)
      const resLow = store.compareAgainstHistory(provider, "99213", 108.0);
      expect(resLow).not.toBeNull();
      expect(resLow?.historicalAverage).toBe(100.0);
      expect(resLow?.increasePercent).toBe(8.0);
      expect(resLow?.isMaterialIncrease).toBe(false);
      expect(resLow?.priorBillsCount).toBe(3);
      expect(resLow?.dateRange.start).toBe("2025-06-01");
      expect(resLow?.dateRange.end).toBe("2025-12-01");

      // Case 2: Candidate is $125 (+25% increase, exceeds 15% threshold)
      const resHigh = store.compareAgainstHistory(provider, "99213", 125.0);
      expect(resHigh).not.toBeNull();
      expect(resHigh?.increasePercent).toBe(25.0);
      expect(resHigh?.isMaterialIncrease).toBe(true);
    });
  });

  describe("Audit Bill Integration (shared/bill-audit.ts)", () => {
    it("cross-references new charges against provider history during bill audit", () => {
      const providerId = "valley-hospital";
      store.recordCharge({
        providerId,
        cptCode: "99214",
        chargedAmount: 100.0,
        dateOfService: "2026-02-01",
      });
      store.recordCharge({
        providerId,
        cptCode: "99214",
        chargedAmount: 100.0,
        dateOfService: "2026-05-01",
      });

      // Audit bill with a 30% price hike for CPT 99214
      const result = auditBill(
        [
          {
            cptCode: "99214",
            description: "Office Visit Level 4",
            chargedAmount: 130.0,
            quantity: 1,
          },
        ],
        {
          providerId,
          providerHistoryLookup: (cpt, amt) => store.compareAgainstHistory(providerId, cpt, amt),
        }
      );

      // Verify line item comparison basis metadata
      expect(result.lineItems[0].historicalComparison).toBeDefined();
      expect(result.lineItems[0].historicalComparison?.priorBillsCount).toBe(2);
      expect(result.lineItems[0].historicalComparison?.historicalAverage).toBe(100.0);
      expect(result.lineItems[0].historicalComparison?.increasePercent).toBe(30.0);
      expect(result.lineItems[0].historicalComparison?.isMaterialIncrease).toBe(true);

      // Verify overall comparison basis metadata
      expect(result.comparisonBasis).toBeDefined();
      expect(result.comparisonBasis?.priorBillsCount).toBe(2);
      expect(result.comparisonBasis?.providerId).toBe("valley-hospital");
      expect(result.comparisonBasis?.dateRange.start).toBe("2026-02-01");
      expect(result.comparisonBasis?.dateRange.end).toBe("2026-05-01");
    });
  });
});
