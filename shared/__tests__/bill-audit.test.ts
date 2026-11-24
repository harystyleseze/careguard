import { describe, it, expect } from "vitest";
import { auditBill, FAIR_MARKET_RATES } from "../bill-audit.ts";

describe("Shared Bill Audit Logic (Issue #8)", () => {
  it("exports FAIR_MARKET_RATES with 15 CPT codes", () => {
    expect(Object.keys(FAIR_MARKET_RATES).length).toBe(15);
    expect(FAIR_MARKET_RATES["99213"]).toEqual({
      description: "Office visit, established patient, moderate",
      fairRate: 130,
    });
  });

  it("handles valid line items correctly", () => {
    const lineItems = [
      { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 130 },
    ];
    const result = auditBill(lineItems);
    expect(result.errorCount).toBe(0);
    expect(result.totalOvercharge).toBe(0);
    expect(result.lineItems[0].status).toBe("valid");
    expect(result.lineItems[0].errorDescription).toBeNull();
  });

  it("detects duplicate charges for CPT codes not on allowlist", () => {
    const lineItems = [
      { description: "CBC", cptCode: "85025", quantity: 1, chargedAmount: 15 },
      { description: "CBC duplicate", cptCode: "85025", quantity: 1, chargedAmount: 15 },
    ];
    const result = auditBill(lineItems);
    expect(result.errorCount).toBe(1);
    expect(result.lineItems[1].status).toBe("duplicate");
    expect(result.lineItems[1].suggestedAmount).toBe(0);
  });

  it("detects overcharges when chargedAmount exceeds threshold", () => {
    const lineItems = [
      // Fair rate 130 * 1 = 130; charged 220 (> 130 * 1.5 = 195)
      { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 220 },
    ];
    const result = auditBill(lineItems);
    expect(result.errorCount).toBe(1);
    expect(result.lineItems[0].status).toBe("overcharged");
    expect(result.lineItems[0].suggestedAmount).toBe(156); // 130 * 1.2
  });

  it("detects upcoding when chargedAmount exceeds upcoded threshold", () => {
    const lineItems = [
      // Fair rate 130 * 1 = 130; charged 500 (> 130 * 3.0 = 390)
      { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 500 },
    ];
    const result = auditBill(lineItems);
    expect(result.errorCount).toBe(1);
    expect(result.lineItems[0].status).toBe("upcoded");
  });

  it("handles missing/unknown CPT codes gracefully", () => {
    const lineItems = [
      { description: "Custom experimental procedure", cptCode: "99999", quantity: 1, chargedAmount: 500 },
    ];
    const result = auditBill(lineItems);
    expect(result.errorCount).toBe(0);
    expect(result.lineItems[0].fairMarketRate).toBeNull();
    expect(result.lineItems[0].status).toBe("valid");
    expect(result.lineItems[0].suggestedAmount).toBe(500);
  });

  it("surfaces stale rates in the recommendation and result", () => {
    const result = auditBill(
      [
        {
          description: "Office visit",
          cptCode: "99213",
          quantity: 1,
          chargedAmount: 130,
        },
      ],
      { ratesValidUntil: "2000-01-01" },
    );

    expect(result.isStale).toBe(true);
    expect(result.recommendation).toMatch(/rates used are stale/i);
  });

  it("preserves the recommendation for current rates", () => {
    const result = auditBill(
      [
        {
          description: "Office visit",
          cptCode: "99213",
          quantity: 1,
          chargedAmount: 130,
        },
      ],
      { ratesValidUntil: "2999-01-01" },
    );

    expect(result.isStale).toBe(false);
    expect(result.recommendation).toBe(
      "No errors detected. This bill appears correct.",
    );
  });
});
