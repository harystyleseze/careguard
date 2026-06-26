import { describe, expect, it } from "vitest";
import { BillAuditValidationError, validateLineItems } from "../../../shared/bill-audit.ts";

describe("bill audit line item validation", () => {
  it.each([
    ["missing field", [{ description: "Office visit", quantity: 1, chargedAmount: 130 }]],
    ["zero qty", [{ description: "Office visit", cptCode: "99213", quantity: 0, chargedAmount: 130 }]],
    ["negative amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: -1 }]],
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
});
