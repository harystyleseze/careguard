import { describe, expect, it } from "vitest";
import {
  BillAuditValidationError,
  validateBillAuditRequest,
  validateLineItems,
} from "../../../shared/bill-audit.ts";

describe("bill audit line item validation", () => {
  it.each([
    ["missing field", [{ description: "Office visit", quantity: 1, chargedAmount: 130 }]],
    ["zero qty", [{ description: "Office visit", cptCode: "99213", quantity: 0, chargedAmount: 130 }]],
    ["fractional qty", [{ description: "Office visit", cptCode: "99213", quantity: 1.5, chargedAmount: 130 }]],
    ["too many units", [{ description: "Office visit", cptCode: "99213", quantity: 1000, chargedAmount: 130 }]],
    ["negative amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: -1 }]],
    ["NaN amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: Number.NaN }]],
    ["Infinity amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: Number.POSITIVE_INFINITY }]],
    ["too large amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 1_000_001 }]],
    ["malformed cpt", [{ description: "Office visit", cptCode: "AB123", quantity: 1, chargedAmount: 130 }]],
    ["too long description", [{ description: "x".repeat(81), cptCode: "99213", quantity: 1, chargedAmount: 130 }]],
  ])("rejects %s", (_label, lineItems) => {
    try {
      validateLineItems(lineItems as any);
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BillAuditValidationError);
      const validationError = error as BillAuditValidationError;
      expect(validationError.code).toBe("INVALID_LINE_ITEMS");
      expect(validationError.issues.length).toBeGreaterThan(0);
    }
  });

  it("keeps valid inputs unchanged after validation", () => {
    const lineItems = [
      { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 0 },
      { description: "Injection", cptCode: "J0170", quantity: 999, chargedAmount: 1_000_000 },
    ];

    expect(validateBillAuditRequest({ lineItems })).toEqual({ lineItems });
  });

  it("returns field-level issue paths for request validation failures", () => {
    try {
      validateBillAuditRequest({
        lineItems: [
          { description: "Office visit", cptCode: "99213", quantity: 1000, chargedAmount: Number.POSITIVE_INFINITY },
        ],
      });
      throw new Error("expected validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BillAuditValidationError);
      const validationError = error as BillAuditValidationError;
      expect(validationError.code).toBe("INVALID_BILL_AUDIT_REQUEST");
      expect(validationError.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "lineItems.0.quantity" }),
          expect.objectContaining({ path: "lineItems.0.chargedAmount" }),
        ]),
      );
    }
  });
});
