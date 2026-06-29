// CareGuard Shared Types

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

import { z } from 'zod';

// ── Medication ────────────────────────────────────────────────────────────────

export const MedicationSchema = z.object({
  name: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  currentPharmacy: z.string().optional(),
  currentPrice: z.number().nonnegative().optional(),
  nextRefillDate: z.string().optional(),
});

export type Medication = z.infer<typeof MedicationSchema>;

// ── PharmacyPrice ─────────────────────────────────────────────────────────────

export const PharmacyPriceSchema = z.object({
  pharmacyName: z.string().min(1),
  pharmacyId: z.string().min(1),
  price: z.number().nonnegative(),
  distance: z.string().optional(),
  inStock: z.union([z.boolean(), z.literal('unknown')]),
});

export type PharmacyPrice = z.infer<typeof PharmacyPriceSchema>;

// ── PriceComparisonResult ─────────────────────────────────────────────────────

export const PriceComparisonResultSchema = z.object({
  drug: z.string().min(1),
  dosage: z.string(),
  zipCode: z.string(),
  prices: z.array(PharmacyPriceSchema),
  cheapest: PharmacyPriceSchema,
  mostExpensive: PharmacyPriceSchema,
  potentialSavings: z.number().nonnegative(),
});

export type PriceComparisonResult = z.infer<typeof PriceComparisonResultSchema>;

// ── BillLineItem ──────────────────────────────────────────────────────────────

export const BillLineItemSchema = z.object({
  description: z.string().min(1),
  cptCode: z.string().optional(),
  chargedAmount: z.number().nonnegative(),
  fairMarketRate: z.number().nonnegative().optional(),
  status: z.enum(['valid', 'duplicate', 'upcoded', 'unbundled', 'error']),
  errorDescription: z.string().optional(),
  suggestedAmount: z.number().nonnegative().optional(),
});

export type BillLineItem = z.infer<typeof BillLineItemSchema>;

// ── BillAuditResult ───────────────────────────────────────────────────────────

export const BillAuditResultSchema = z.object({
  totalCharged: z.number().nonnegative(),
  totalCorrect: z.number().nonnegative(),
  totalOvercharge: z.number().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  lineItems: z.array(BillLineItemSchema),
  recommendation: z.string(),
});

export type BillAuditResult = z.infer<typeof BillAuditResultSchema>;

// ── SpendingPolicy ────────────────────────────────────────────────────────────

export const SpendingPolicySchema = z.object({
  dailyLimit: z.number().positive(),
  monthlyLimit: z.number().positive(),
  medicationMonthlyBudget: z.number().nonnegative(),
  billMonthlyBudget: z.number().nonnegative(),
  approvalThreshold: z.number().nonnegative(),
  holdTimeSeconds: z.number().int().nonnegative(),
  /**
   * IANA timezone string for the caregiver's local day (Issue #207).
   * Example: "America/Phoenix", "America/New_York", "Europe/London".
   * When set, daily-limit checks use this timezone to determine "today"
   * rather than UTC or the global SPENDING_TIMEZONE env var.
   * Defaults to the SPENDING_TIMEZONE env var if omitted.
   */
  timezone: z.string().optional(),
  toolFees: z.record(z.string(), z.number()).optional(),
  notifications: z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      emailAddress: z.string().optional(),
      phoneNumber: z.string().optional(),
    })
    .optional(),
});

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

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

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

// ── Transaction ───────────────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.enum(['medication', 'bill', 'service_fee']),
  description: z.string(),
  amount: z.number().nonnegative(),
  recipient: z.string(),
  // Always a real 64-char hex Stellar tx hash, or undefined. Never a raw/base64
  // payment receipt — the backend normalizes that before recording the transaction (#14).
  stellarTxHash: z.string().regex(STELLAR_TX_HASH_RE).optional(),
  // 'extracted': hash was successfully parsed from the x402 PAYMENT-RESPONSE header.
  // 'extraction_failed': header was present but all parse strategies failed (#191).
  txHashStatus: z.enum(['extracted', 'extraction_failed']).optional(),
  mppOrderId: z.string().optional(),
  status: z.enum([
    'pending',
    'approved',
    'completed',
    'blocked',
    'disputed',
    'cancelled',
    'rejected',
  ]),
  category: z.enum(TRANSACTION_CATEGORIES),
  pendingUntil: z.string().optional(),
  submittedAt: z.string().optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// ── AgentAction ───────────────────────────────────────────────────────────────

export const AgentActionSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  action: z.string(),
  details: z.string(),
  cost: z.number().nonnegative(),
  result: z.string(),
  transactions: z.array(TransactionSchema),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

// ── CareRecipient ─────────────────────────────────────────────────────────────

export interface CareRecipient {
  name: string;
  walletAddress: string;
  medications: Medication[];
  spendingPolicy: SpendingPolicy;
  monthlySpending: {
    medications: number;
    bills: number;
    serviceFees: number;
    total: number;
  };
  savingsAchieved: number;
}

// ── Alert ─────────────────────────────────────────────────────────────────────

export const AlertSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  type: z.enum([
    'approval_needed',
    'error_found',
    'refill_due',
    'budget_warning',
    'policy_blocked',
  ]),
  title: z.string(),
  description: z.string(),
  amount: z.number().nonnegative().optional(),
  actionRequired: z.boolean(),
  resolved: z.boolean(),
});

export type Alert = z.infer<typeof AlertSchema>;
