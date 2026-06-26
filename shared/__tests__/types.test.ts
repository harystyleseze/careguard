import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  AgentActionSchema,
  AlertSchema,
  BillAuditResultSchema,
  BillLineItemSchema,
  CareRecipientSchema,
  MedicationSchema,
  PharmacyPriceSchema,
  PriceComparisonResultSchema,
  SpendingPolicySchema,
  TRANSACTION_CATEGORY,
  TransactionSchema,
  isTransactionCategory,
  normalizeTransactionCategory,
  type AgentAction,
  type Alert,
  type BillAuditResult,
  type BillLineItem,
  type CareRecipient,
  type Medication,
  type PharmacyPrice,
  type PriceComparisonResult,
  type SpendingPolicy,
  type Transaction,
  type TransactionCategory,
} from '../types.ts';

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

const medicationFixture = {
  name: 'Metformin',
  dosage: '500mg',
  frequency: 'twice daily',
  currentPharmacy: 'CarePlus',
  currentPrice: 8.25,
  nextRefillDate: '2026-07-01',
};

const pharmacyPriceFixture = {
  pharmacyName: 'CarePlus',
  pharmacyId: 'careplus-1',
  price: 8.25,
  distance: '1.2 mi',
  inStock: true,
};

const billLineItemFixture = {
  description: 'Office visit',
  cptCode: '99213',
  chargedAmount: 130,
  fairMarketRate: 95,
  status: 'valid',
  suggestedAmount: 95,
};

const billAuditResultFixture = {
  totalCharged: 130,
  totalCorrect: 95,
  totalOvercharge: 35,
  errorCount: 1,
  lineItems: [billLineItemFixture],
  recommendation: 'Request an itemized correction.',
};

const spendingPolicyFixture = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
  timezone: 'America/Phoenix',
  toolFees: {
    comparePharmacyPrices: 0.002,
    auditBill: 0.01,
  },
  notifications: {
    email: true,
    sms: false,
    emailAddress: 'caregiver@example.com',
  },
};

const transactionFixture = {
  id: 'tx-1',
  timestamp: '2026-06-26T12:00:00.000Z',
  type: 'bill',
  description: 'Hospital visit',
  amount: 50,
  recipient: 'provider-1',
  stellarTxHash: 'a'.repeat(64),
  status: 'completed',
  category: TRANSACTION_CATEGORY.BILLS,
};

const priceComparisonFixture = {
  drug: 'Metformin',
  dosage: '500mg',
  zipCode: '90210',
  prices: [pharmacyPriceFixture],
  cheapest: pharmacyPriceFixture,
  mostExpensive: pharmacyPriceFixture,
  potentialSavings: 4.5,
};

const agentActionFixture = {
  id: 'action-1',
  timestamp: '2026-06-26T12:00:00.000Z',
  action: 'pay_bill',
  details: 'Paid hospital bill',
  cost: 0.01,
  result: 'completed',
  transactions: [transactionFixture],
};

const careRecipientFixture = {
  name: 'Rosa',
  walletAddress: 'GBWEDYWFGPNPAWCYOKWMCRPTR4IMV4SNZ7CVOZHPUXGHVXXPJSCFKVXQ',
  medications: [medicationFixture],
  spendingPolicy: spendingPolicyFixture,
  monthlySpending: {
    medications: 10,
    bills: 20,
    serviceFees: 0.02,
    total: 30.02,
  },
  savingsAchieved: 12.5,
};

const alertFixture = {
  id: 'alert-1',
  timestamp: '2026-06-26T12:00:00.000Z',
  type: 'approval_needed',
  title: 'Approval needed',
  description: 'A payment needs caregiver approval.',
  amount: 85,
  actionRequired: true,
  resolved: false,
};

const schemaCases: Array<{
  name: string;
  schema: z.ZodTypeAny;
  valid: unknown;
  invalid: unknown;
}> = [
  {
    name: 'MedicationSchema',
    schema: MedicationSchema,
    valid: medicationFixture,
    invalid: { ...medicationFixture, dosage: 500 },
  },
  {
    name: 'PharmacyPriceSchema',
    schema: PharmacyPriceSchema,
    valid: pharmacyPriceFixture,
    invalid: { ...pharmacyPriceFixture, inStock: 'yes' },
  },
  {
    name: 'PriceComparisonResultSchema',
    schema: PriceComparisonResultSchema,
    valid: priceComparisonFixture,
    invalid: { ...priceComparisonFixture, prices: [] as unknown[], cheapest: undefined },
  },
  {
    name: 'BillLineItemSchema',
    schema: BillLineItemSchema,
    valid: billLineItemFixture,
    invalid: { ...billLineItemFixture, status: 'review' },
  },
  {
    name: 'BillAuditResultSchema',
    schema: BillAuditResultSchema,
    valid: billAuditResultFixture,
    invalid: { ...billAuditResultFixture, lineItems: [{ ...billLineItemFixture, chargedAmount: '130' }] },
  },
  {
    name: 'SpendingPolicySchema',
    schema: SpendingPolicySchema,
    valid: spendingPolicyFixture,
    invalid: { ...spendingPolicyFixture, notifications: { email: 'yes', sms: false } },
  },
  {
    name: 'TransactionSchema',
    schema: TransactionSchema,
    valid: transactionFixture,
    invalid: { ...transactionFixture, stellarTxHash: 'not-a-hash' },
  },
  {
    name: 'AgentActionSchema',
    schema: AgentActionSchema,
    valid: agentActionFixture,
    invalid: { ...agentActionFixture, transactions: [{ ...transactionFixture, category: 'legacy' }] },
  },
  {
    name: 'CareRecipientSchema',
    schema: CareRecipientSchema,
    valid: careRecipientFixture,
    invalid: { ...careRecipientFixture, monthlySpending: { ...careRecipientFixture.monthlySpending, total: '30.02' } },
  },
  {
    name: 'AlertSchema',
    schema: AlertSchema,
    valid: alertFixture,
    invalid: { ...alertFixture, type: 'informational' },
  },
];

describe('Runtime schemas', () => {
  it.each(schemaCases)('$name accepts a canonical valid fixture', ({ schema, valid }) => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it.each(schemaCases)('$name rejects a malformed fixture', ({ schema, invalid }) => {
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it('derives exported TypeScript types from their matching schemas', () => {
    expectTypeOf<Medication>().toEqualTypeOf<z.infer<typeof MedicationSchema>>();
    expectTypeOf<PharmacyPrice>().toEqualTypeOf<
      z.infer<typeof PharmacyPriceSchema>
    >();
    expectTypeOf<PriceComparisonResult>().toEqualTypeOf<
      z.infer<typeof PriceComparisonResultSchema>
    >();
    expectTypeOf<BillLineItem>().toEqualTypeOf<
      z.infer<typeof BillLineItemSchema>
    >();
    expectTypeOf<BillAuditResult>().toEqualTypeOf<
      z.infer<typeof BillAuditResultSchema>
    >();
    expectTypeOf<SpendingPolicy>().toEqualTypeOf<
      z.infer<typeof SpendingPolicySchema>
    >();
    expectTypeOf<Transaction>().toEqualTypeOf<
      z.infer<typeof TransactionSchema>
    >();
    expectTypeOf<AgentAction>().toEqualTypeOf<
      z.infer<typeof AgentActionSchema>
    >();
    expectTypeOf<CareRecipient>().toEqualTypeOf<
      z.infer<typeof CareRecipientSchema>
    >();
    expectTypeOf<Alert>().toEqualTypeOf<z.infer<typeof AlertSchema>>();
  });
});
