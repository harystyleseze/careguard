// CareGuard Shared Types

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
  inStock: boolean;
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
  status: "valid" | "duplicate" | "upcoded" | "unbundled" | "error";
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
}

export interface Transaction {
  id: string;
  timestamp: string;
  type: "medication" | "bill" | "service_fee";
  description: string;
  amount: number;
  recipient: string;
  stellarTxHash?: string;
  mppOrderId?: string;
  status: "pending" | "approved" | "completed" | "blocked" | "disputed";
  category: string;
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
  type: "approval_needed" | "error_found" | "refill_due" | "budget_warning" | "policy_blocked";
  title: string;
  description: string;
  amount?: number;
  actionRequired: boolean;
  resolved: boolean;
}
