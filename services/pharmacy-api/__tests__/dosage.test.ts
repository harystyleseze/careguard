import { describe, expect, it } from 'vitest';
import { resolveRequestedDosage } from '../dosage.ts';

describe('Pharmacy dosage round-trip', () => {
  it('stores and returns the per-drug dosage from the request', () => {
    expect(resolveRequestedDosage('lisinopril', '10mg')).toBe('10mg');
    expect(resolveRequestedDosage('lisinopril')).toBe('10mg');
  });
});
