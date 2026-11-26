import { describe, it, expect, vi } from 'vitest';

// Pre-define environment variables before importing server.ts
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (path: any, options: any) => {
      if (typeof path === 'string' && path.includes('audit_thresholds.json')) {
        throw new Error('Mock read failure');
      }
      return actual.readFileSync(path, options);
    },
  };
});

vi.hoisted(() => {
  process.env.BILL_PROVIDER_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER = '2.0';
  process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER = '1.5';
  process.env.BILL_AUDIT_UPCODED_MULTIPLIER = '4.0';
});


import { auditBill, validateBillAuditMultipliers } from '../server.ts';

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

  describe('Boot-time multiplier validation drill (Issue #968)', () => {
    it('refuses to boot when BILL_AUDIT_UPCODED_MULTIPLIER <= BILL_AUDIT_OVERCHARGE_MULTIPLIER', () => {
      expect(() => validateBillAuditMultipliers(2.0, 1.2, 2.0)).toThrow(
        /Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1\.0/,
      );
      expect(() => validateBillAuditMultipliers(3.0, 1.2, 2.5)).toThrow(
        /got UPCODED=2\.5, OVERCHARGE=3, SUGGESTED=1\.2/,
      );
    });

    it('refuses to boot when BILL_AUDIT_SUGGESTED_MULTIPLIER <= 1.0', () => {
      expect(() => validateBillAuditMultipliers(1.5, 1.0, 3.0)).toThrow(
        /Invalid bill-audit multipliers config/,
      );
      expect(() => validateBillAuditMultipliers(1.5, 0.9, 3.0)).toThrow(
        /got UPCODED=3, OVERCHARGE=1\.5, SUGGESTED=0\.9/,
      );
    });

    it('accepts Medicare-strictness and commercial-tolerance runbook examples', () => {
      // Medicare-like strictness: OVERCHARGE=1.3, SUGGESTED=1.1, UPCODED=3.0 (default)
      expect(() => validateBillAuditMultipliers(1.3, 1.1, 3.0)).not.toThrow();
      // Commercial insurance tolerance: OVERCHARGE=2.0, SUGGESTED=1.5, UPCODED=4.0
      expect(() => validateBillAuditMultipliers(2.0, 1.5, 4.0)).not.toThrow();
    });
  });
});
