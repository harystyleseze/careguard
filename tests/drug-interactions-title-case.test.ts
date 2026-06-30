import { describe, it, expect } from 'vitest';
import { checkInteractions } from '../services/drug-interaction-api/logic.ts';

describe('checkInteractions — Title Case normalisation (issue #14)', () => {
  it('returns Title-Cased names when input is all-lowercase', () => {
    const result = checkInteractions(['lisinopril', 'ibuprofen']);
    expect(result.medications).toEqual(['Lisinopril', 'Ibuprofen']);
    const interaction = result.interactions.find(
      (i) => (i.drug1 === 'Lisinopril' && i.drug2 === 'Ibuprofen') ||
              (i.drug1 === 'Ibuprofen' && i.drug2 === 'Lisinopril'),
    );
    expect(interaction).toBeDefined();
    expect(interaction!.drug1).toBe('Lisinopril');
    expect(interaction!.drug2).toBe('Ibuprofen');
  });

  it('returns Title-Cased names when input is ALL-UPPERCASE', () => {
    const result = checkInteractions(['LISINOPRIL', 'IBUPROFEN']);
    expect(result.medications).toEqual(['Lisinopril', 'Ibuprofen']);
    const interaction = result.interactions.find(
      (i) => (i.drug1 === 'Lisinopril' && i.drug2 === 'Ibuprofen') ||
              (i.drug1 === 'Ibuprofen' && i.drug2 === 'Lisinopril'),
    );
    expect(interaction).toBeDefined();
    expect(interaction!.drug1).toBe('Lisinopril');
    expect(interaction!.drug2).toBe('Ibuprofen');
  });

  it('returns Title-Cased names when input is MixedCase', () => {
    const result = checkInteractions(['LiSiNoPrIl', 'iBuPrOfEn']);
    expect(result.medications).toEqual(['Lisinopril', 'Ibuprofen']);
    const interaction = result.interactions.find(
      (i) => (i.drug1 === 'Lisinopril' && i.drug2 === 'Ibuprofen') ||
              (i.drug1 === 'Ibuprofen' && i.drug2 === 'Lisinopril'),
    );
    expect(interaction).toBeDefined();
  });

  it('produces identical output regardless of input casing', () => {
    const lower = checkInteractions(['lisinopril', 'ibuprofen']);
    const upper = checkInteractions(['LISINOPRIL', 'IBUPROFEN']);
    const mixed = checkInteractions(['Lisinopril', 'Ibuprofen']);
    expect(lower.medications).toEqual(upper.medications);
    expect(lower.medications).toEqual(mixed.medications);
    expect(lower.interactions.length).toBe(upper.interactions.length);
  });

  it('medications array in response is Title-Cased', () => {
    const result = checkInteractions(['metformin', 'atorvastatin', 'LISINOPRIL']);
    for (const med of result.medications) {
      expect(med[0]).toBe(med[0].toUpperCase());
      expect(med.slice(1)).toBe(med.slice(1).toLowerCase());
    }
  });

  it('no interactions found still returns Title-Cased medications list', () => {
    const result = checkInteractions(['metformin', 'lisinopril']);
    expect(result.medications).toEqual(['Metformin', 'Lisinopril']);
  });
});
