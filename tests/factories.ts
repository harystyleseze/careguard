import type {
  Medication,
  PharmacyPrice,
  PriceComparisonResult,
  BillLineItem,
  BillAuditResult,
  SpendingPolicy,
  Transaction,
  AgentAction,
  CareRecipient,
  Alert,
} from "../shared/types.ts";

// Seeded PRNG (mulberry32) for deterministic outputs
function createRng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(42);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

// ----- Factories -----

export function makeMedication(overrides?: Partial<Medication>): Medication {
  return {
    name: "Lisinopril",
    dosage: "10 mg",
    frequency: "Once daily",
    currentPharmacy: "CVS Pharmacy",
    currentPrice: 12.99,
    nextRefillDate: "2026-07-15",
    ...overrides,
  };
}

export function makePharmacyPrice(overrides?: Partial<PharmacyPrice>): PharmacyPrice {
  return {
    pharmacyName: pick(["Costco Pharmacy", "CVS Pharmacy", "Walgreens", "Walmart Pharmacy"]),
    pharmacyId: pick(["costco-001", "cvs-001", "walgreens-001", "walmart-001"]),
    price: +(rng() * 15 + 2).toFixed(2),
    distance: `${(rng() * 5 + 0.1).toFixed(1)} mi`,
    inStock: true,
    ...overrides,
  };
}

export function makePriceComparisonResult(overrides?: Partial<PriceComparisonResult>): PriceComparisonResult {
  const drug = "Lisinopril";
  const prices = [makePharmacyPrice(), makePharmacyPrice(), makePharmacyPrice()];
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  return {
    drug,
    dosage: "10 mg",
    zipCode: "90210",
    prices,
    cheapest: { pharmacyName: sorted[0].pharmacyName, pharmacyId: sorted[0].pharmacyId, price: sorted[0].price, distance: sorted[0].distance },
    mostExpensive: { pharmacyName: sorted[sorted.length - 1].pharmacyName, pharmacyId: sorted[sorted.length - 1].pharmacyId, price: sorted[sorted.length - 1].price },
    potentialSavings: +(sorted[sorted.length - 1].price - sorted[0].price).toFixed(2),
    ...overrides,
  };
}

export function makeBillLineItem(overrides?: Partial<BillLineItem>): BillLineItem {
  return {
    description: "ER Visit - Level 3",
    cptCode: "99283",
    chargedAmount: +(rng() * 1000 + 100).toFixed(2),
    fairMarketRate: +(rng() * 800 + 80).toFixed(2),
    status: "valid",
    ...overrides,
  };
}

export function makeBillAuditResult(overrides?: Partial<BillAuditResult>): BillAuditResult {
  const lineItems = [
    makeBillLineItem({ status: "valid" }),
    makeBillLineItem({ status: "upcoded", errorDescription: "Level 3 billed for Level 2 service", suggestedAmount: 150 }),
    makeBillLineItem({ status: "valid" }),
  ];
  const totalCharged = +lineItems.reduce((s, i) => s + i.chargedAmount, 0).toFixed(2);
  const totalCorrect = +lineItems.reduce((s, i) => s + (i.suggestedAmount ?? i.chargedAmount), 0).toFixed(2);
  return {
    totalCharged,
    totalCorrect,
    totalOvercharge: +(totalCharged - totalCorrect).toFixed(2),
    errorCount: lineItems.filter((i) => i.status !== "valid").length,
    lineItems,
    recommendation: "Dispute upcoded ER visit and request corrected billing.",
    ...overrides,
  };
}

export function makeSpendingPolicy(overrides?: Partial<SpendingPolicy>): SpendingPolicy {
  return {
    dailyLimit: 100,
    monthlyLimit: 500,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
    ...overrides,
  };
}

export function makeTransaction(overrides?: Partial<Transaction>): Transaction {
  const types = ["medication", "bill", "service_fee"] as const;
  const type = overrides?.type ?? pick([...types]);
  const descriptions: Record<string, string> = {
    medication: "Lisinopril from Costco Pharmacy [MPP Charge]",
    bill: "Payment to General Hospital for ER Visit",
    service_fee: "x402 query: pharmacy prices",
  };
  const amounts: Record<string, number> = {
    medication: 3.5,
    bill: 250,
    service_fee: 0.002,
  };
  return {
    id: `tx-${Date.now()}-${String(rng()).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    description: descriptions[type],
    amount: amounts[type],
    recipient: type === "medication" ? "costco-001" : type === "bill" ? "general-hospital" : "pharmacy-price-api",
    stellarTxHash: type !== "service_fee" ? "a".repeat(64) : undefined,
    status: "completed",
    category: type === "medication" ? "medications" : type === "bill" ? "bills" : "service_fees",
    ...overrides,
  };
}

export function makeAgentAction(overrides?: Partial<AgentAction>): AgentAction {
  const tool = pick(["compare_pharmacy_prices", "check_drug_interactions", "audit_medical_bill", "pay_for_medication"]);
  return {
    id: `action-${Date.now()}-${String(rng()).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action: tool,
    details: `Ran ${tool} for Rosa Garcia`,
    cost: +(rng() * 0.01).toFixed(4),
    result: "Completed successfully",
    transactions: [makeTransaction()],
    ...overrides,
  };
}

export function makeCareRecipient(overrides?: Partial<CareRecipient>): CareRecipient {
  return {
    name: "Rosa Garcia",
    walletAddress: "GBQTESTWALLET123",
    medications: [
      makeMedication({ name: "Lisinopril", dosage: "10 mg", frequency: "Once daily", currentPharmacy: "CVS Pharmacy", currentPrice: 12.99 }),
      makeMedication({ name: "Metformin", dosage: "500 mg", frequency: "Twice daily", currentPharmacy: "Walgreens", currentPrice: 8.49 }),
      makeMedication({ name: "Atorvastatin", dosage: "20 mg", frequency: "Once daily", currentPharmacy: "CVS Pharmacy", currentPrice: 15.99 }),
      makeMedication({ name: "Amlodipine", dosage: "5 mg", frequency: "Once daily", currentPharmacy: "Walmart Pharmacy", currentPrice: 6.99 }),
    ],
    spendingPolicy: makeSpendingPolicy(),
    monthlySpending: { medications: 42.5, bills: 250, serviceFees: 0.008, total: 292.508 },
    savingsAchieved: 73.5,
    ...overrides,
  };
}

export function makeAlert(overrides?: Partial<Alert>): Alert {
  const types = ["approval_needed", "error_found", "refill_due", "budget_warning", "policy_blocked"] as const;
  const type = overrides?.type ?? pick([...types]);
  return {
    id: `alert-${Date.now()}-${String(rng()).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    type,
    title: type === "policy_blocked" ? "Payment Blocked by Policy" : "Alert",
    description: type === "policy_blocked"
      ? "A $600 payment attempt was blocked — exceeds the $500 bill monthly budget."
      : "Action may be required.",
    amount: type === "policy_blocked" ? 600 : undefined,
    actionRequired: type === "approval_needed",
    resolved: false,
    ...overrides,
  };
}
