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

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  currentPharmacy?: string;
  currentPrice?: number;
  nextRefillDate?: string;
}

export interface PharmacyPrice {
  pharmacyName: string;
  pharmacyId: string;
  price: number;
  distance?: string;
  inStock: boolean | 'unknown';
}

export interface PriceComparisonResult {
  drug: string;
  dosage: string;
  zipCode: string;
  prices: PharmacyPrice[];
  cheapest: PharmacyPrice;
  mostExpensive: PharmacyPrice;
  potentialSavings: number;
}

export interface BillLineItem {
  description: string;
  cptCode?: string;
  chargedAmount: number;
  fairMarketRate?: number;
  status: 'valid' | 'duplicate' | 'upcoded' | 'unbundled' | 'error';
  errorDescription?: string;
  suggestedAmount?: number;
}

export interface BillAuditResult {
  totalCharged: number;
  totalCorrect: number;
  totalOvercharge: number;
  errorCount: number;
  lineItems: BillLineItem[];
  recommendation: string;
}

export interface SpendingPolicy {
  dailyLimit: number;
  monthlyLimit: number;
  medicationMonthlyBudget: number;
  billMonthlyBudget: number;
  approvalThreshold: number; // require caregiver approval above this amount
  holdTimeSeconds: number; // time before pending approvals auto-approve
  /**
   * IANA timezone string for the caregiver's local day (Issue #207).
   * Example: "America/Phoenix", "America/New_York", "Europe/London".
   * When set, daily-limit checks use this timezone to determine "today"
   * rather than UTC or the global SPENDING_TIMEZONE env var.
   * Defaults to the SPENDING_TIMEZONE env var if omitted.
   */
  timezone?: string;
  toolFees?: Record<string, number>; // per-tool query fees (e.g., comparePharmacyPrices: 0.002)
  notifications?: {
    email: boolean;
    sms: boolean;
    emailAddress?: string;
    phoneNumber?: string;
  };
}

export const SPENDING_POLICY_MAX_VALUE = 50_000;

const moneyPolicyField = (name: string) =>
  z
    .number({
      required_error: `${name} is required`,
      invalid_type_error: `${name} must be a finite number`,
    })
    .finite(`${name} must be a finite number`)
    .positive(`${name} must be greater than 0`)
    .max(SPENDING_POLICY_MAX_VALUE, `${name} cannot exceed ${SPENDING_POLICY_MAX_VALUE}`);

export const SpendingPolicyInputSchema = z
  .object({
    dailyLimit: moneyPolicyField('dailyLimit'),
    monthlyLimit: moneyPolicyField('monthlyLimit'),
    medicationMonthlyBudget: moneyPolicyField('medicationMonthlyBudget'),
    billMonthlyBudget: moneyPolicyField('billMonthlyBudget'),
    approvalThreshold: moneyPolicyField('approvalThreshold'),
    holdTimeSeconds: z
      .number({
        invalid_type_error: 'holdTimeSeconds must be a finite number',
      })
      .finite('holdTimeSeconds must be a finite number')
      .nonnegative('holdTimeSeconds cannot be negative')
      .max(
        SPENDING_POLICY_MAX_VALUE,
        `holdTimeSeconds cannot exceed ${SPENDING_POLICY_MAX_VALUE}`,
      )
      .optional()
      .default(0),
    timezone: z.string().min(1, 'timezone cannot be empty').optional(),
    toolFees: z
      .record(
        z
          .number({ invalid_type_error: 'tool fee must be a finite number' })
          .finite('tool fee must be a finite number')
          .nonnegative('tool fee cannot be negative')
          .max(SPENDING_POLICY_MAX_VALUE, `tool fee cannot exceed ${SPENDING_POLICY_MAX_VALUE}`),
      )
      .optional(),
    notifications: z
      .object({
        email: z.boolean().optional().default(false),
        sms: z.boolean().optional().default(false),
        emailAddress: z.string().min(1, 'emailAddress cannot be empty').optional(),
        phoneNumber: z.string().min(1, 'phoneNumber cannot be empty').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.dailyLimit > policy.monthlyLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dailyLimit'],
        message: 'dailyLimit cannot exceed monthlyLimit',
      });
    }

    if (policy.approvalThreshold > policy.dailyLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approvalThreshold'],
        message: 'approvalThreshold cannot exceed dailyLimit',
      });
    }

    if (policy.medicationMonthlyBudget + policy.billMonthlyBudget > policy.monthlyLimit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['medicationMonthlyBudget'],
        message: 'medicationMonthlyBudget + billMonthlyBudget cannot exceed monthlyLimit',
      });
    }
  });

export type SpendingPolicyInput = z.input<typeof SpendingPolicyInputSchema>;

export type SpendingPolicyValidationIssue = {
  field: string;
  code: string;
  message: string;
};

export function formatSpendingPolicyValidationIssues(
  error: z.ZodError,
): SpendingPolicyValidationIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'policy',
    code: issue.code,
    message: issue.message,
  }));
}

export class SpendingPolicyValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_SPENDING_POLICY';
  readonly issues: SpendingPolicyValidationIssue[];

  constructor(issues: SpendingPolicyValidationIssue[]) {
    const reason = issues.map((issue) => issue.message).join('; ');
    super(reason ? `Invalid spending policy: ${reason}` : 'Invalid spending policy');
    this.name = 'SpendingPolicyValidationError';
    this.issues = issues;
  }
}

export function parseSpendingPolicyInput(input: unknown): SpendingPolicy {
  const result = SpendingPolicyInputSchema.safeParse(input);
  if (!result.success) {
    throw new SpendingPolicyValidationError(
      formatSpendingPolicyValidationIssues(result.error),
    );
  }
  return result.data as SpendingPolicy;
}

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

export interface Transaction {
  id: string;
  timestamp: string;
  type: 'medication' | 'bill' | 'service_fee';
  description: string;
  amount: number;
  recipient: string;
  // Always a real 64-char hex Stellar tx hash, or undefined. Never a raw/base64
  // payment receipt — the backend normalizes that before recording the transaction (#14).
  stellarTxHash?: string;
  mppOrderId?: string;
  status:
    | 'pending'
    | 'approved'
    | 'completed'
    | 'blocked'
    | 'disputed'
    | 'cancelled'
    | 'rejected';
  category: TransactionCategory;
  pendingUntil?: string;
  submittedAt?: string;
}

export interface AgentAction {
  id: string;
  timestamp: string;
  action: string;
  details: string;
  cost: number; // agent service fee paid via x402
  result: string;
  transactions: Transaction[];
}

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

export interface Alert {
  id: string;
  timestamp: string;
  type:
    | 'approval_needed'
    | 'error_found'
    | 'refill_due'
    | 'budget_warning'
    | 'policy_blocked';
  title: string;
  description: string;
  amount?: number;
  actionRequired: boolean;
  resolved: boolean;
}
