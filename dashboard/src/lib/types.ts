import { z } from "zod";

export const BillLineItemSchema = z.object({
  description: z.string(),
  cptCode: z.string().optional(),
  quantity: z.number(),
  chargedAmount: z.number(),
  status: z.enum(["valid", "duplicate", "upcoded", "unbundled", "error"]),
  suggestedAmount: z.number().optional(),
  errorDescription: z.string().optional(),
});

export const BillAuditResultSchema = z.object({
  totalCharged: z.number(),
  totalCorrect: z.number(),
  totalOvercharge: z.number(),
  errorCount: z.number(),
  savingsPercent: z.number().optional(),
  lineItems: z.array(BillLineItemSchema),
  recommendation: z.string().optional(),
});

export type BillAuditResult = z.infer<typeof BillAuditResultSchema>;

export const PharmacyPriceSchema = z.object({
  pharmacyName: z.string(),
  pharmacyId: z.string().optional(),
  price: z.number(),
  distance: z.string().optional(),
  inStock: z.boolean().optional(),
});

export const PharmacyCompareResultSchema = z.object({
  drug: z.string(),
  prices: z.array(PharmacyPriceSchema),
  cheapest: PharmacyPriceSchema,
  mostExpensive: PharmacyPriceSchema.optional(),
  potentialSavings: z.number().optional(),
  savingsPercent: z.number().optional(),
});

export type PharmacyCompareResult = z.infer<typeof PharmacyCompareResultSchema>;

export const DrugInteractionSchema = z.object({
  drug1: z.string(),
  drug2: z.string(),
  severity: z.string(),
  recommendation: z.string(),
});

export const DrugInteractionResultSchema = z.object({
  summary: z.string().optional(),
  interactions: z.array(DrugInteractionSchema).optional(),
});

export type DrugInteractionResult = z.infer<typeof DrugInteractionResultSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(["medication", "bill", "service_fee"]),
  description: z.string(),
  amount: z.number(),
  recipient: z.string(),
  stellarTxHash: z.string().optional(),
  status: z.string(),
  category: z.string(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

export const SpendingDataSchema = z.object({
  policy: z.object({
    dailyLimit: z.number(),
    monthlyLimit: z.number(),
    medicationMonthlyBudget: z.number(),
    billMonthlyBudget: z.number(),
    approvalThreshold: z.number(),
  }),
  spending: z.object({
    medications: z.number(),
    bills: z.number(),
    serviceFees: z.number(),
    total: z.number(),
  }),
  budgetRemaining: z.object({
    medications: z.number(),
    bills: z.number(),
  }),
  transactionCount: z.number(),
  recentTransactions: z.array(TransactionSchema),
});

export type SpendingData = z.infer<typeof SpendingDataSchema>;

