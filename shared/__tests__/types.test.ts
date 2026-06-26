import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  TRANSACTION_CATEGORY,
  isTransactionCategory,
  normalizeTransactionCategory,
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
