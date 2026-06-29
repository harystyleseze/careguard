import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TRANSACTION_CATEGORY,
  isTransactionCategory,
  normalizeTransactionCategory,
  MedicationSchema,
  PharmacyPriceSchema,
  PriceComparisonResultSchema,
  BillLineItemSchema,
  BillAuditResultSchema,
  SpendingPolicySchema,
  TransactionSchema,
  AgentActionSchema,
  AlertSchema,
  type Transaction,
  type TransactionCategory,
} from '../types.ts';

// ── Existing category tests ───────────────────────────────────────────────────

describe('Transaction category typing', () => {
  it('narrows finite transaction categories', () => {
    const category: string = 'medications';

    if (isTransactionCategory(category)) {
      expectTypeOf(category).toEqualTypeOf<TransactionCategory>();
      expect(category).toBe(TRANSACTION_CATEGORY.MEDICATIONS);
    } else {
      throw new Error('expected category to narrow');
    }
  });

  it('keeps Transaction.category on the finite union', () => {
    expectTypeOf<Transaction['category']>().toEqualTypeOf<TransactionCategory>();
    expectTypeOf<'medicaitons'>().not.toMatchTypeOf<TransactionCategory>();
  });

  it('normalizes unknown historical categories to service_fees', () => {
    expect(normalizeTransactionCategory('surprise_bucket')).toBe(
      TRANSACTION_CATEGORY.SERVICE_FEES,
    );
  });
});

// ── MedicationSchema (Issue #33) ──────────────────────────────────────────────

describe('MedicationSchema', () => {
  const valid = {
    name: 'Lisinopril',
    dosage: '10mg',
    frequency: 'once daily',
    currentPharmacy: 'CVS',
    currentPrice: 12.5,
    nextRefillDate: '2026-07-01',
  };

  it('accepts a valid medication', () => {
    expect(MedicationSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts minimal required fields', () => {
    expect(
      MedicationSchema.safeParse({ name: 'Metformin', dosage: '500mg', frequency: 'twice daily' }).success,
    ).toBe(true);
  });

  it('rejects missing name', () => {
    const { name: _, ...rest } = valid;
    expect(MedicationSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty dosage', () => {
    expect(MedicationSchema.safeParse({ ...valid, dosage: '' }).success).toBe(false);
  });

  it('rejects negative currentPrice', () => {
    expect(MedicationSchema.safeParse({ ...valid, currentPrice: -5 }).success).toBe(false);
  });
});

// ── PharmacyPriceSchema ───────────────────────────────────────────────────────

describe('PharmacyPriceSchema', () => {
  const valid = {
    pharmacyName: 'Costco Pharmacy',
    pharmacyId: 'costco-001',
    price: 9.99,
    distance: '2.1 miles',
    inStock: true,
  };

  it('accepts a valid pharmacy price', () => {
    expect(PharmacyPriceSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts inStock = "unknown"', () => {
    expect(PharmacyPriceSchema.safeParse({ ...valid, inStock: 'unknown' }).success).toBe(true);
  });

  it('rejects inStock = "yes" (not a valid value)', () => {
    expect(PharmacyPriceSchema.safeParse({ ...valid, inStock: 'yes' }).success).toBe(false);
  });

  it('rejects negative price', () => {
    expect(PharmacyPriceSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('rejects missing pharmacyId', () => {
    const { pharmacyId: _, ...rest } = valid;
    expect(PharmacyPriceSchema.safeParse(rest).success).toBe(false);
  });
});

// ── PriceComparisonResultSchema ───────────────────────────────────────────────

describe('PriceComparisonResultSchema', () => {
  const pharmacy = { pharmacyName: 'CVS', pharmacyId: 'cvs-1', price: 15, inStock: true };
  const valid = {
    drug: 'atorvastatin',
    dosage: '20mg',
    zipCode: '90210',
    prices: [pharmacy],
    cheapest: pharmacy,
    mostExpensive: pharmacy,
    potentialSavings: 5,
  };

  it('accepts valid comparison result', () => {
    expect(PriceComparisonResultSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects negative potentialSavings', () => {
    expect(PriceComparisonResultSchema.safeParse({ ...valid, potentialSavings: -1 }).success).toBe(false);
  });

  it('rejects empty drug name', () => {
    expect(PriceComparisonResultSchema.safeParse({ ...valid, drug: '' }).success).toBe(false);
  });
});

// ── BillLineItemSchema ────────────────────────────────────────────────────────

describe('BillLineItemSchema', () => {
  const valid = {
    description: 'Office visit',
    cptCode: '99213',
    chargedAmount: 150,
    fairMarketRate: 120,
    status: 'upcoded' as const,
    errorDescription: 'CPT code higher than documented',
    suggestedAmount: 120,
  };

  it('accepts a valid line item', () => {
    expect(BillLineItemSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(BillLineItemSchema.safeParse({ ...valid, status: 'overcharged' }).success).toBe(false);
  });

  it('rejects negative chargedAmount', () => {
    expect(BillLineItemSchema.safeParse({ ...valid, chargedAmount: -10 }).success).toBe(false);
  });

  it('rejects missing description', () => {
    const { description: _, ...rest } = valid;
    expect(BillLineItemSchema.safeParse(rest).success).toBe(false);
  });
});

// ── BillAuditResultSchema ─────────────────────────────────────────────────────

describe('BillAuditResultSchema', () => {
  const lineItem = {
    description: 'Lab test',
    cptCode: '80053',
    chargedAmount: 200,
    status: 'valid' as const,
  };
  const valid = {
    totalCharged: 500,
    totalCorrect: 400,
    totalOvercharge: 100,
    errorCount: 2,
    lineItems: [lineItem],
    recommendation: 'Dispute overcharges with insurer',
  };

  it('accepts a valid audit result', () => {
    expect(BillAuditResultSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects fractional errorCount', () => {
    expect(BillAuditResultSchema.safeParse({ ...valid, errorCount: 1.5 }).success).toBe(false);
  });

  it('rejects negative totalCharged', () => {
    expect(BillAuditResultSchema.safeParse({ ...valid, totalCharged: -1 }).success).toBe(false);
  });
});

// ── SpendingPolicySchema ──────────────────────────────────────────────────────

describe('SpendingPolicySchema', () => {
  const valid = {
    dailyLimit: 100,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
    holdTimeSeconds: 86400,
    timezone: 'America/New_York',
    toolFees: { comparePharmacyPrices: 0.002 },
    notifications: { email: true, sms: false, emailAddress: 'care@example.com' },
  };

  it('accepts a valid spending policy', () => {
    expect(SpendingPolicySchema.safeParse(valid).success).toBe(true);
  });

  it('accepts minimal required fields', () => {
    expect(SpendingPolicySchema.safeParse({
      dailyLimit: 50,
      monthlyLimit: 400,
      medicationMonthlyBudget: 200,
      billMonthlyBudget: 200,
      approvalThreshold: 50,
      holdTimeSeconds: 0,
    }).success).toBe(true);
  });

  it('rejects non-positive dailyLimit', () => {
    expect(SpendingPolicySchema.safeParse({ ...valid, dailyLimit: 0 }).success).toBe(false);
  });

  it('rejects fractional holdTimeSeconds', () => {
    expect(SpendingPolicySchema.safeParse({ ...valid, holdTimeSeconds: 1.5 }).success).toBe(false);
  });

  it('rejects negative approvalThreshold', () => {
    expect(SpendingPolicySchema.safeParse({ ...valid, approvalThreshold: -1 }).success).toBe(false);
  });
});

// ── TransactionSchema ─────────────────────────────────────────────────────────

describe('TransactionSchema', () => {
  const valid = {
    id: 'tx-001',
    timestamp: '2026-06-28T12:00:00Z',
    type: 'medication' as const,
    description: 'Lisinopril 10mg at CVS',
    amount: 12.5,
    recipient: 'CVS Pharmacy',
    stellarTxHash: 'a'.repeat(64),
    txHashStatus: 'extracted' as const,
    status: 'completed' as const,
    category: 'medications' as const,
  };

  it('accepts a valid transaction', () => {
    expect(TransactionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid stellarTxHash format', () => {
    expect(TransactionSchema.safeParse({ ...valid, stellarTxHash: 'not-a-hash' }).success).toBe(false);
  });

  it('rejects invalid transaction type', () => {
    expect(TransactionSchema.safeParse({ ...valid, type: 'transfer' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(TransactionSchema.safeParse({ ...valid, status: 'failed' }).success).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(TransactionSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false);
  });

  it('rejects invalid category', () => {
    expect(TransactionSchema.safeParse({ ...valid, category: 'unknown_category' }).success).toBe(false);
  });
});

// ── AgentActionSchema ─────────────────────────────────────────────────────────

describe('AgentActionSchema', () => {
  const tx = {
    id: 'tx-001',
    timestamp: '2026-06-28T12:00:00Z',
    type: 'service_fee' as const,
    description: 'Drug interaction check',
    amount: 0.001,
    recipient: 'Drug API',
    status: 'completed' as const,
    category: 'service_fees' as const,
  };
  const valid = {
    id: 'action-001',
    timestamp: '2026-06-28T12:00:00Z',
    action: 'check_drug_interactions',
    details: 'Checked interactions for lisinopril + metformin',
    cost: 0.001,
    result: 'No severe interactions found',
    transactions: [tx],
  };

  it('accepts a valid agent action', () => {
    expect(AgentActionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects negative cost', () => {
    expect(AgentActionSchema.safeParse({ ...valid, cost: -0.1 }).success).toBe(false);
  });

  it('rejects missing id', () => {
    const { id: _, ...rest } = valid;
    expect(AgentActionSchema.safeParse(rest).success).toBe(false);
  });
});

// ── AlertSchema ───────────────────────────────────────────────────────────────

describe('AlertSchema', () => {
  const valid = {
    id: 'alert-001',
    timestamp: '2026-06-28T12:00:00Z',
    type: 'budget_warning' as const,
    title: 'Approaching monthly budget',
    description: '$450 of $500 monthly limit used',
    amount: 450,
    actionRequired: false,
    resolved: false,
  };

  it('accepts a valid alert', () => {
    expect(AlertSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts alert without optional amount', () => {
    const { amount: _, ...noAmount } = valid;
    expect(AlertSchema.safeParse(noAmount).success).toBe(true);
  });

  it('rejects invalid alert type', () => {
    expect(AlertSchema.safeParse({ ...valid, type: 'unknown_event' }).success).toBe(false);
  });

  it('rejects negative amount', () => {
    expect(AlertSchema.safeParse({ ...valid, amount: -1 }).success).toBe(false);
  });

  it('rejects missing resolved field', () => {
    const { resolved: _, ...noResolved } = valid;
    expect(AlertSchema.safeParse(noResolved).success).toBe(false);
  });
});
