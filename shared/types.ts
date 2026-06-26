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
  approvalThreshold: number; // require caregiver approval at or above this amount
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
