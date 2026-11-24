import { beforeEach, describe, expect, it } from 'vitest';
import { resolveRequestedDosage, clearDosageCache } from '../dosage.ts';

describe('Pharmacy dosage round-trip and recipient scoping (Issue #1065)', () => {
  beforeEach(() => {
    clearDosageCache();
  });

  it('stores and returns the per-drug dosage from the request in default scope', () => {
    expect(resolveRequestedDosage('lisinopril', '10mg')).toBe('10mg');
    expect(resolveRequestedDosage('lisinopril')).toBe('10mg');
  });

  it('scopes dosage per recipient and prevents cross-recipient dosage leakage', () => {
    // Caregiver queries Lisinopril for recipient 'rosa' with dosage '20mg'
    expect(resolveRequestedDosage('lisinopril', '20mg', 'rosa')).toBe('20mg');

    // Subsequent query for 'rosa' with no dosage specified remembers '20mg'
    expect(resolveRequestedDosage('lisinopril', undefined, 'rosa')).toBe('20mg');

    // Unrelated query for completely different recipient 'carlos' with no dosage specified
    // must NOT receive 'rosa's 20mg, but should return 'unspecified'
    expect(resolveRequestedDosage('lisinopril', undefined, 'carlos')).toBe('unspecified');

    // Explicitly setting dosage for 'carlos' to '10mg' sets Carlos's scope
    expect(resolveRequestedDosage('lisinopril', '10mg', 'carlos')).toBe('10mg');

    // Both recipients maintain their independent, isolated dosage values
    expect(resolveRequestedDosage('lisinopril', undefined, 'carlos')).toBe('10mg');
    expect(resolveRequestedDosage('lisinopril', undefined, 'rosa')).toBe('20mg');
  });

  it('preserves last-seen dosage across multiple distinct drugs for the same recipient', () => {
    resolveRequestedDosage('metformin', '500mg', 'rosa');
    resolveRequestedDosage('atorvastatin', '40mg', 'rosa');

    expect(resolveRequestedDosage('metformin', undefined, 'rosa')).toBe('500mg');
    expect(resolveRequestedDosage('atorvastatin', undefined, 'rosa')).toBe('40mg');
    expect(resolveRequestedDosage('amlodipine', undefined, 'rosa')).toBe('unspecified');
  });

  it('supports clearDosageCache for single recipient or globally', () => {
    resolveRequestedDosage('lisinopril', '20mg', 'rosa');
    resolveRequestedDosage('lisinopril', '10mg', 'carlos');

    clearDosageCache('rosa');
    expect(resolveRequestedDosage('lisinopril', undefined, 'rosa')).toBe('unspecified');
    expect(resolveRequestedDosage('lisinopril', undefined, 'carlos')).toBe('10mg');

    clearDosageCache();
    expect(resolveRequestedDosage('lisinopril', undefined, 'carlos')).toBe('unspecified');
  });
});

