import { describe, it, expect } from "vitest";
import { z } from "zod";

const CPT_CODE_PATTERN = /^(?:\d{5}|J\d{4})$/;

const BillItemSchema = z.object({
  description: z.string().min(1, "description is required"),
  cptCode: z.string().regex(CPT_CODE_PATTERN, "cptCode must be a valid CPT code (5 digits or J followed by 4 digits)"),
  quantity: z.number().positive("quantity must be positive"),
  chargedAmount: z.number().nonnegative("chargedAmount must be non-negative"),
});

const BillAuditRequestSchema = z.object({
  lineItems: z.array(BillItemSchema).min(1, "lineItems must contain at least one item"),
});

describe("CPT code validation", () => {
  it("accepts valid 5-digit CPT code", () => {
    const result = BillItemSchema.safeParse({
      description: "Office visit",
      cptCode: "99213",
      quantity: 1,
      chargedAmount: 130,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid J-code (J + 4 digits)", () => {
    const result = BillItemSchema.safeParse({
      description: "Adrenaline injection",
      cptCode: "J0170",
      quantity: 1,
      chargedAmount: 15,
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-numeric CPT code", () => {
    const result = BillItemSchema.safeParse({
      description: "Invalid code",
      cptCode: "abc",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("cptCode must be a valid CPT code");
    }
  });

  it("rejects 4-digit code", () => {
    const result = BillItemSchema.safeParse({
      description: "Too short",
      cptCode: "9921",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects 6-digit code", () => {
    const result = BillItemSchema.safeParse({
      description: "Too long",
      cptCode: "992134",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects code with special characters", () => {
    const result = BillItemSchema.safeParse({
      description: "Special chars",
      cptCode: "99-213",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = BillItemSchema.safeParse({
      description: "Empty code",
      cptCode: "",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects J-code with wrong digit count", () => {
    const result = BillItemSchema.safeParse({
      description: "Wrong J-code",
      cptCode: "J017",
      quantity: 1,
      chargedAmount: 100,
    });
    expect(result.success).toBe(false);
  });

  it("validates a complete bill audit request with valid codes", () => {
    const result = BillAuditRequestSchema.safeParse({
      lineItems: [
        { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 130 },
        { description: "Injection", cptCode: "J0170", quantity: 1, chargedAmount: 15 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bill audit request with invalid CPT code", () => {
    const result = BillAuditRequestSchema.safeParse({
      lineItems: [
        { description: "Invalid", cptCode: "abc", quantity: 1, chargedAmount: 100 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
