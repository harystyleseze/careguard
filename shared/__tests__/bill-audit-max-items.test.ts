import { describe, expect, it, vi } from "vitest";
import {
  createBillAuditMaxItemsMiddleware,
  getBillAuditMaxItems,
  validateBillAuditRequest,
} from "../bill-audit.ts";

function makeItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    description: `Office visit ${index}`,
    cptCode: "99213",
    quantity: 1,
    chargedAmount: 130,
  }));
}

function runMiddleware(lineItems: unknown[], max = "500") {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const next = vi.fn();
  const onReject = vi.fn();

  const middleware = createBillAuditMaxItemsMiddleware({
    env: { BILL_AUDIT_MAX_ITEMS: max } as NodeJS.ProcessEnv,
    onReject,
  });

  middleware({ body: { lineItems } } as any, { status, json } as any, next);

  return { status, json, next, onReject };
}

describe("bill audit max line item guard", () => {
  it("defaults to 500 items when BILL_AUDIT_MAX_ITEMS is unset or invalid", () => {
    expect(getBillAuditMaxItems({} as NodeJS.ProcessEnv)).toBe(500);
    expect(getBillAuditMaxItems({ BILL_AUDIT_MAX_ITEMS: "nope" } as NodeJS.ProcessEnv)).toBe(500);
  });

  it("rejects a 501-item body before downstream middleware", () => {
    const result = runMiddleware(makeItems(501));

    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({ error: "lineItems exceeds max (500)" });
    expect(result.next).not.toHaveBeenCalled();
    expect(result.onReject).toHaveBeenCalledTimes(1);
  });

  it("allows a 500-item body to continue", () => {
    const result = runMiddleware(makeItems(500));

    expect(result.status).not.toHaveBeenCalled();
    expect(result.json).not.toHaveBeenCalled();
    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.onReject).not.toHaveBeenCalled();
  });

  it("keeps the same cap as a validation fallback", () => {
    expect(() => validateBillAuditRequest({ lineItems: makeItems(501) }))
      .toThrow("lineItems exceeds max (500)");
  });
});
