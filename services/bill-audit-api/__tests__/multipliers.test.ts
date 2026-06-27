import { describe, it, expect, vi } from 'vitest';

// Pre-define environment variables before importing server.ts
vi.hoisted(() => {
  process.env.BILL_PROVIDER_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER = '2.0';
  process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER = '1.5';
  process.env.BILL_AUDIT_UPCODED_MULTIPLIER = '4.0';
});


import { auditBill } from '../server.ts';

describe('Bill Audit Multipliers via Env', () => {
  it('should respect custom multipliers set in environment variables', () => {
    // CMS Fair rate for 99213 is 130
    // Under custom env:
    // overcharge threshold: 130 * 2.0 = 260
    // suggested multiplier: 130 * 1.5 = 195
    // upcoded threshold: 130 * 4.0 = 520

    // Test 1: Charged amount is 250 (within 2.0x threshold, so status should be valid)
    const result1 = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 250 },
    ]);
    expect(result1.lineItems[0].status).toBe('valid');
    expect(result1.lineItems[0].suggestedAmount).toBe(195); // Math.min(250, 195) = 195

    // Test 2: Charged amount is 300 (exceeds 260, but under 520, so status is overcharged)
    const result2 = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 300 },
    ]);
    expect(result2.lineItems[0].status).toBe('overcharged');
    expect(result2.lineItems[0].suggestedAmount).toBe(195); // 130 * 1.5 = 195

    // Test 3: Charged amount is 550 (exceeds 520, so status is upcoded)
    const result3 = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 550 },
    ]);
    expect(result3.lineItems[0].status).toBe('upcoded');
    expect(result3.lineItems[0].suggestedAmount).toBe(195);
  });
});
