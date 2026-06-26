// CareGuard Shared Types

import { z } from 'zod';

/**
 * Drug Interaction Severity Convention
 * 
 * The following severity levels are used for drug interactions,
 * ordered by clinical risk:
 * - "severe" (0): Life-threatening or requires immediate intervention
 * - "moderate" (1): Significant interaction requiring monitoring/adjustment
 * - "mild" (2): Minor interaction with minimal clinical impact
 * 
 * When sorting interactions, severe > moderate > mild.
 * For interactions with equal severity, sort alphabetically by drug names.
 */

export const MedicationSchema = z
  .object({
    name: z.string(),
    dosage: z.string(),
    frequency: z.string(),
    currentPharmacy: z.string().optional(),
    currentPrice: z.number().optional(),
    nextRefillDate: z.string().optional(),
  })
  .strict();
export type Medication = z.infer<typeof MedicationSchema>;

export const PharmacyPriceSchema = z
  .object({
    pharmacyName: z.string(),
    pharmacyId: z.string(),
    price: z.number(),
    distance: z.string().optional(),
    inStock: z.union([z.boolean(), z.literal('unknown')]),
  })
  .strict();
export type PharmacyPrice = z.infer<typeof PharmacyPriceSchema>;

export const PriceComparisonResultSchema = z
  .object({
    drug: z.string(),
    dosage: z.string(),
    zipCode: z.string(),
    prices: z.array(PharmacyPriceSchema),
    cheapest: PharmacyPriceSchema,
    mostExpensive: PharmacyPriceSchema,
    potentialSavings: z.number(),
  })
  .strict();
export type PriceComparisonResult = z.infer<
  typeof PriceComparisonResultSchema
>;

export const BillLineItemStatusSchema = z.enum([
  'valid',
  'duplicate',
  'upcoded',
  'unbundled',
  'error',
]);

export const BillLineItemSchema = z
  .object({
    description: z.string(),
    cptCode: z.string().optional(),
    chargedAmount: z.number(),
    fairMarketRate: z.number().optional(),
    status: BillLineItemStatusSchema,
    errorDescription: z.string().optional(),
    suggestedAmount: z.number().optional(),
  })
  .strict();
export type BillLineItem = z.infer<typeof BillLineItemSchema>;

export const BillAuditResultSchema = z
  .object({
    totalCharged: z.number(),
    totalCorrect: z.number(),
    totalOvercharge: z.number(),
    errorCount: z.number(),
    lineItems: z.array(BillLineItemSchema),
    recommendation: z.string(),
  })
  .strict();
export type BillAuditResult = z.infer<typeof BillAuditResultSchema>;

export const SpendingPolicySchema = z
  .object({
    dailyLimit: z.number(),
    monthlyLimit: z.number(),
    medicationMonthlyBudget: z.number(),
    billMonthlyBudget: z.number(),
    approvalThreshold: z.number(), // require caregiver approval above this amount
    holdTimeSeconds: z.number(), // time before pending approvals auto-approve
    /**
     * IANA timezone string for the caregiver's local day (Issue #207).
     * Example: "America/Phoenix", "America/New_York", "Europe/London".
     * When set, daily-limit checks use this timezone to determine "today"
     * rather than UTC or the global SPENDING_TIMEZONE env var.
     * Defaults to the SPENDING_TIMEZONE env var if omitted.
     */
    timezone: z.string().optional(),
    toolFees: z.record(z.number()).optional(), // per-tool query fees (e.g., comparePharmacyPrices: 0.002)
    notifications: z
      .object({
        email: z.boolean(),
        sms: z.boolean(),
        emailAddress: z.string().optional(),
        phoneNumber: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SpendingPolicy = z.infer<typeof SpendingPolicySchema>;

// A confirmed Stellar transaction hash is always 64 lowercase/uppercase hex chars.
export const STELLAR_TX_HASH_RE = /^[0-9a-f]{64}$/i;

export const TRANSACTION_CATEGORY = {
  MEDICATIONS: 'medications',
  BILLS: 'bills',
  SERVICE_FEES: 'service_fees',
} as const;

export const TRANSACTION_CATEGORIES = [
  TRANSACTION_CATEGORY.MEDICATIONS,
  TRANSACTION_CATEGORY.BILLS,
  TRANSACTION_CATEGORY.SERVICE_FEES,
] as const;

export const TransactionCategorySchema = z.enum([
  TRANSACTION_CATEGORY.MEDICATIONS,
  TRANSACTION_CATEGORY.BILLS,
  TRANSACTION_CATEGORY.SERVICE_FEES,
]);

export type TransactionCategory = z.infer<typeof TransactionCategorySchema>;

export function isTransactionCategory(
  category: unknown,
): category is TransactionCategory {
  return (
    typeof category === 'string' &&
    (TRANSACTION_CATEGORIES as readonly string[]).includes(category)
  );
}

export function normalizeTransactionCategory(
  category: unknown,
): TransactionCategory {
  return isTransactionCategory(category)
    ? category
    : TRANSACTION_CATEGORY.SERVICE_FEES;
}

export const TransactionTypeSchema = z.enum([
  'medication',
  'bill',
  'service_fee',
]);

export const TransactionStatusSchema = z.enum([
  'pending',
  'approved',
  'completed',
  'blocked',
  'disputed',
  'cancelled',
  'rejected',
]);

export const TransactionSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    type: TransactionTypeSchema,
    description: z.string(),
    amount: z.number(),
    recipient: z.string(),
    // Always a real 64-char hex Stellar tx hash, or undefined. Never a raw/base64
    // payment receipt — the backend normalizes that before recording the transaction (#14).
    stellarTxHash: z.string().regex(STELLAR_TX_HASH_RE).optional(),
    mppOrderId: z.string().optional(),
    status: TransactionStatusSchema,
    category: TransactionCategorySchema,
    pendingUntil: z.string().optional(),
    submittedAt: z.string().optional(),
  })
  .strict();
export type Transaction = z.infer<typeof TransactionSchema>;

export const AgentActionSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    action: z.string(),
    details: z.string(),
    cost: z.number(), // agent service fee paid via x402
    result: z.string(),
    transactions: z.array(TransactionSchema),
  })
  .strict();
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const CareRecipientSchema = z
  .object({
    name: z.string(),
    walletAddress: z.string(),
    medications: z.array(MedicationSchema),
    spendingPolicy: SpendingPolicySchema,
    monthlySpending: z
      .object({
        medications: z.number(),
        bills: z.number(),
        serviceFees: z.number(),
        total: z.number(),
      })
      .strict(),
    savingsAchieved: z.number(),
  })
  .strict();
export type CareRecipient = z.infer<typeof CareRecipientSchema>;

export const AlertTypeSchema = z.enum([
  'approval_needed',
  'error_found',
  'refill_due',
  'budget_warning',
  'policy_blocked',
]);

export const AlertSchema = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    type: AlertTypeSchema,
    title: z.string(),
    description: z.string(),
    amount: z.number().optional(),
    actionRequired: z.boolean(),
    resolved: z.boolean(),
  })
  .strict();
export type Alert = z.infer<typeof AlertSchema>;
