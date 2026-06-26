import { z } from "zod";
import type { RequestHandler } from "express";
import { freeTextSchema } from "./free-text.ts";

export const DEFAULT_BILL_AUDIT_MAX_ITEMS = 500;

export const LineItemSchema = z
  .object({
    description: freeTextSchema("description"),
    cptCode: z
      .string()
      .regex(/^(?:\d{5}|J\d{4})$/, "cptCode must match /^(?:\\d{5}|J\\d{4})$/"),
    quantity: z.number().positive("quantity must be positive"),
    chargedAmount: z.number().positive("chargedAmount must be positive"),
  })
  .strict();

export type LineItem = z.infer<typeof LineItemSchema>;

export const BillAuditRequestSchema = z
  .object({
    lineItems: z.array(LineItemSchema).min(1, "lineItems must contain at least one item"),
  })
  .strict();

export type ValidationIssue = {
  path: string;
  message: string;
};

function formatIssues(issues: z.ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
    message: issue.message,
  }));
}

export class BillAuditValidationError extends Error {
  readonly code: string;
  readonly issues: ValidationIssue[];

  constructor(code: string, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "BillAuditValidationError";
    this.code = code;
    this.issues = issues;
  }
}

export function getBillAuditMaxItems(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.BILL_AUDIT_MAX_ITEMS);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_BILL_AUDIT_MAX_ITEMS;
}

export function validateBillAuditMaxItems(
  body: unknown,
  maxItems = getBillAuditMaxItems(),
): void {
  const lineItems = body && typeof body === "object"
    ? (body as { lineItems?: unknown }).lineItems
    : undefined;

  if (Array.isArray(lineItems) && lineItems.length > maxItems) {
    throw new BillAuditValidationError(
      "LINE_ITEMS_TOO_LARGE",
      `lineItems exceeds max (${maxItems})`,
      [{ path: "lineItems", message: `lineItems exceeds max (${maxItems})` }],
    );
  }
}

export function createBillAuditMaxItemsMiddleware(options: {
  env?: NodeJS.ProcessEnv;
  onReject?: () => void;
} = {}): RequestHandler {
  return (req, res, next) => {
    const maxItems = getBillAuditMaxItems(options.env);

    try {
      validateBillAuditMaxItems(req.body, maxItems);
      next();
    } catch (error) {
      if (error instanceof BillAuditValidationError) {
        options.onReject?.();
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  };
}

export function validateLineItems(lineItems: unknown): LineItem[] {
  const result = z.array(LineItemSchema).min(1, "lineItems must contain at least one item").safeParse(lineItems);
  if (result.success) {
    return result.data;
  }

  throw new BillAuditValidationError(
    "INVALID_LINE_ITEMS",
    "Line items must be an array of objects with description, cptCode, quantity, and chargedAmount",
    formatIssues(result.error.issues),
  );
}

export function validateBillAuditRequest(body: unknown): { lineItems: LineItem[] } {
  validateBillAuditMaxItems(body);

  const result = BillAuditRequestSchema.safeParse(body);
  if (result.success) {
    return result.data;
  }

  throw new BillAuditValidationError(
    "INVALID_BILL_AUDIT_REQUEST",
    "Request body must contain a valid lineItems array",
    formatIssues(result.error.issues),
  );
}
