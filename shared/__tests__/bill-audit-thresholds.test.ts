import { describe, expect, it } from "vitest";
import {
  getBillAuditChargeStatus,
  getBillAuditSuggestedAmount,
  readBillAuditThresholds,
  validateBillAuditThresholds,
} from "../bill-audit-thresholds.ts";

describe("bill audit threshold configuration", () => {
  it("uses the default bill audit multipliers", () => {
    expect(readBillAuditThresholds({})).toEqual({
      overchargeMultiplier: 1.5,
      suggestedMultiplier: 1.2,
      upcodedMultiplier: 3.0,
    });
  });

  it("validates threshold ordering at boot", () => {
    expect(() =>
      validateBillAuditThresholds({
        overchargeMultiplier: 1.2,
        suggestedMultiplier: 1.5,
        upcodedMultiplier: 3.0,
      }),
    ).toThrow(/UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER/);
  });

  it("changes audit verdicts for the same line item when env thresholds change", () => {
    const lineItem = { cptCode: "99213", chargedAmount: 170, fairAmount: 100 };

    const defaultThresholds = readBillAuditThresholds({});
    const lenientThresholds = readBillAuditThresholds({
      BILL_AUDIT_SUGGESTED_MULTIPLIER: "1.2",
      BILL_AUDIT_OVERCHARGE_MULTIPLIER: "2.0",
      BILL_AUDIT_UPCODED_MULTIPLIER: "3.0",
    });
    const aggressiveThresholds = readBillAuditThresholds({
      BILL_AUDIT_SUGGESTED_MULTIPLIER: "1.1",
      BILL_AUDIT_OVERCHARGE_MULTIPLIER: "1.25",
      BILL_AUDIT_UPCODED_MULTIPLIER: "1.6",
    });

    expect(getBillAuditChargeStatus({ ...lineItem, thresholds: defaultThresholds })).toBe("overcharged");
    expect(getBillAuditChargeStatus({ ...lineItem, thresholds: lenientThresholds })).toBe("valid");
    expect(getBillAuditChargeStatus({ ...lineItem, thresholds: aggressiveThresholds })).toBe("upcoded");
  });

  it("uses the suggested multiplier when calculating corrected amounts", () => {
    const thresholds = readBillAuditThresholds({
      BILL_AUDIT_SUGGESTED_MULTIPLIER: "1.4",
      BILL_AUDIT_OVERCHARGE_MULTIPLIER: "1.5",
      BILL_AUDIT_UPCODED_MULTIPLIER: "3.0",
    });

    expect(getBillAuditSuggestedAmount({ fairAmount: 100, chargedAmount: 200, thresholds })).toBe(140);
  });
});
