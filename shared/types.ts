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
  approvalThreshold: number; // require caregiver approval above this amount
  holdTimeSeconds: number; // time before pending approvals auto-approve
  notifications?: {
    email: boolean;
    sms: boolean;
    emailAddress?: string;
    phoneNumber?: string;
  };
}

export interface Transaction {
  id: string;
  timestamp: string;
  type: 'medication' | 'bill' | 'service_fee';
  description: string;
  amount: number;
  recipient: string;
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
  category: string;
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
