import { describe, it, expect } from 'vitest';

interface Interaction {
  drugs: [string, string];
  severity: 'mild' | 'moderate' | 'severe';
}

function normalizeInteractions(interactions: Interaction[]): Interaction[] {
  return interactions.map(ix => ({
    ...ix,
    drugs: [ix.drugs[0].toLowerCase(), ix.drugs[1].toLowerCase()] as [string, string],
  }));
}

const RAW_INTERACTIONS: Interaction[] = [
  { drugs: ['lisinopril', 'potassium'], severity: 'severe' },
  { drugs: ['metformin', 'alcohol'], severity: 'severe' },
  { drugs: ['atorvastatin', 'grapefruit'], severity: 'moderate' },
  { drugs: ['lisinopril', 'ibuprofen'], severity: 'moderate' },
  { drugs: ['amlodipine', 'atorvastatin'], severity: 'mild' },
];

const NORMALIZED = normalizeInteractions(RAW_INTERACTIONS);

describe('INTERACTIONS drug pair normalization', () => {
  it('all normalized drug names are lowercase', () => {
    for (const ix of NORMALIZED) {
      expect(ix.drugs[0]).toBe(ix.drugs[0].toLowerCase());
      expect(ix.drugs[1]).toBe(ix.drugs[1].toLowerCase());
    }
  });

  it('matches Lisinopril (title case) against normalized pairs', () => {
    const found = NORMALIZED.some(ix => ix.drugs.includes('Lisinopril'.toLowerCase()));
    expect(found).toBe(true);
  });

  it('matches LISINOPRIL (all caps) against normalized pairs', () => {
    const found = NORMALIZED.some(ix => ix.drugs.includes('LISINOPRIL'.toLowerCase()));
    expect(found).toBe(true);
  });

  it('matches lisinopril (lowercase) against normalized pairs', () => {
    const found = NORMALIZED.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('matches lIsInOpRiL (mixed case) against normalized pairs', () => {
    const found = NORMALIZED.some(ix => ix.drugs.includes('lIsInOpRiL'.toLowerCase()));
    expect(found).toBe(true);
  });

  it('matches LisinoPril (camel case) against normalized pairs', () => {
    const found = NORMALIZED.some(ix => ix.drugs.includes('LisinoPril'.toLowerCase()));
    expect(found).toBe(true);
  });

  it('normalization is idempotent', () => {
    const once = normalizeInteractions(RAW_INTERACTIONS);
    const twice = normalizeInteractions(once);
    expect(twice).toEqual(once);
  });

  it('severity is preserved after normalization', () => {
    const severe = NORMALIZED.filter(ix => ix.severity === 'severe');
    expect(severe.length).toBe(2);
  });
});
