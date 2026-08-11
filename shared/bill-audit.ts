import { z } from "zod";
import { freeTextSchema } from "./free-text.ts";

export const LineItemSchema = z
  .object({
    description: freeTextSchema("description"),
    cptCode: z
      .string()
      .regex(/^(?:\d{5}|J\d{4})$/, "cptCode must match /^(?:\\d{5}|J\\d{4})$/"),
    quantity: z
      .number()
      .finite("quantity must be finite")
      .int("quantity must be an integer")
      .min(1, "quantity must be at least 1")
      .max(999, "quantity must be at most 999"),
    chargedAmount: z
      .number()
      .finite("chargedAmount must be finite")
      .min(0, "chargedAmount must be at least 0")
      .max(1_000_000, "chargedAmount must be at most 1000000"),
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

export interface FairMarketRate {
  description: string;
  fairRate: number;
}

export const FAIR_MARKET_RATES: Record<string, FairMarketRate> = {
  "99213": { description: "Office visit, established patient, moderate", fairRate: 130 },
  "99214": { description: "Office visit, established patient, high", fairRate: 195 },
  "99215": { description: "Office visit, established patient, complex", fairRate: 265 },
  "70553": { description: "MRI brain with and without contrast", fairRate: 450 },
  "71046": { description: "Chest X-ray, 2 views", fairRate: 45 },
  "80053": { description: "Comprehensive metabolic panel", fairRate: 25 },
  "85025": { description: "Complete blood count (CBC)", fairRate: 15 },
  "36415": { description: "Venipuncture (blood draw)", fairRate: 10 },
  "93000": { description: "Electrocardiogram (ECG)", fairRate: 35 },
  "99232": { description: "Hospital care, moderate complexity", fairRate: 145 },
  "99233": { description: "Hospital care, high complexity", fairRate: 210 },
  "99238": { description: "Hospital discharge day management", fairRate: 160 },
  "96372": { description: "Injection, subcutaneous or intramuscular", fairRate: 25 },
  J0170: { description: "Adrenaline/epinephrine injection", fairRate: 15 },
  "97110": { description: "Physical therapy, therapeutic exercises", fairRate: 55 },
};

export interface AuditBillOptions {
  network?: string;
  payTo?: string;
  duplicateAllowlist?: Set<string>;
  getAuditThreshold?: (cptCode: string) => number;
  overchargeMultiplier?: number;
  suggestedMultiplier?: number;
  upcodedMultiplier?: number;
  ratesAsOf?: string;
  ratesValidUntil?: string;
}

export function auditBill(lineItems: any[], options: AuditBillOptions = {}) {
  const network = options.network ?? "stellar:testnet";
  const payTo = options.payTo ?? process.env.BILL_PROVIDER_PUBLIC_KEY ?? "";
  const allowlist = options.duplicateAllowlist ?? new Set(["96372", "97110"]);
  const getThreshold = options.getAuditThreshold ?? ((_cptCode?: string) => options.overchargeMultiplier ?? 1.5);
  const suggestedMultiplier = options.suggestedMultiplier ?? 1.2;
  const upcodedMultiplier = options.upcodedMultiplier ?? 3.0;
  const ratesAsOf = options.ratesAsOf ?? "2026-01-01";
  const ratesValidUntil = options.ratesValidUntil ?? "2026-12-31";

  const results: any[] = [];
  let totalCharged = 0;
  let totalCorrect = 0;
  let errorCount = 0;
  const seenCodes: Record<string, number> = {};

  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fairRate = FAIR_MARKET_RATES[item.cptCode];
    const fairAmount = fairRate !== undefined ? fairRate.fairRate * item.quantity : null;
    const threshold = getThreshold(item.cptCode);

    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (seenCodes[item.cptCode] > 1 && !allowlist.has(item.cptCode)) {
      errorCount++;
      results.push({
        description: item.description,
        cptCode: item.cptCode,
        quantity: item.quantity,
        chargedAmount: item.chargedAmount,
        fairMarketRate: fairAmount,
        status: "duplicate",
        errorDescription: `Duplicate charge for CPT ${item.cptCode}. Appears ${seenCodes[item.cptCode]} times.`,
        suggestedAmount: 0,
      });
      continue;
    }

    if (fairAmount !== null && item.chargedAmount > fairAmount * threshold) {
      errorCount++;
      const suggestedAmount = +(fairAmount * suggestedMultiplier).toFixed(2);
      totalCorrect += suggestedAmount;
      results.push({
        description: item.description,
        cptCode: item.cptCode,
        quantity: item.quantity,
        chargedAmount: item.chargedAmount,
        fairMarketRate: fairAmount,
        status: item.chargedAmount > fairAmount * upcodedMultiplier ? "upcoded" : "overcharged",
        errorDescription: `Charged $${item.chargedAmount} — CMS fair market rate is $${fairAmount}. Overcharged by $${(item.chargedAmount - fairAmount).toFixed(2)}.`,
        suggestedAmount,
      });
      continue;
    }

    const suggested = fairAmount !== null
      ? Math.min(item.chargedAmount, +(fairAmount * suggestedMultiplier).toFixed(2))
      : item.chargedAmount;
    totalCorrect += suggested;
    results.push({
      description: item.description,
      cptCode: item.cptCode,
      quantity: item.quantity,
      chargedAmount: item.chargedAmount,
      fairMarketRate: fairAmount,
      status: "valid",
      errorDescription: null,
      suggestedAmount: suggested,
    });
  }

  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);
  const savingsPercent = totalCharged > 0 ? +((totalOvercharge / totalCharged) * 100).toFixed(1) : 0;
  const now = new Date();
  const validUntil = new Date(ratesValidUntil);
  const isStale = now > validUntil;

  return {
    auditTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network, price: "$0.01", payTo },
    totalCharged: +totalCharged.toFixed(2),
    totalCorrect: +totalCorrect.toFixed(2),
    totalOvercharge,
    savingsPercent,
    errorCount,
    lineItems: results,
    dataFreshness: { ratesAsOf, validUntil: ratesValidUntil, isStale },
    recommendation: errorCount === 0
      ? "No errors detected. This bill appears correct."
      : `Found ${errorCount} errors totaling $${totalOvercharge} in overcharges (${savingsPercent}% of total bill). Strongly recommend filing a formal dispute.`,
  };
}
