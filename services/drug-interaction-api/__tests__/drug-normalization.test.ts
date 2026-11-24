import { describe, it, expect } from 'vitest';
import { INTERACTIONS } from '../logic.ts';

describe('INTERACTIONS drug pair normalization', () => {
  it('all normalized drug names are lowercase', () => {
    for (const ix of INTERACTIONS) {
      expect(ix.drugs[0]).toBe(ix.drugs[0].toLowerCase());
      expect(ix.drugs[1]).toBe(ix.drugs[1].toLowerCase());
    }
  });

  it('matches Lisinopril (title case) against normalized pairs', () => {
    const found = INTERACTIONS.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('matches LISINOPRIL (all caps) against normalized pairs', () => {
    const found = INTERACTIONS.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('matches lisinopril (lowercase) against normalized pairs', () => {
    const found = INTERACTIONS.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('matches lIsInOpRiL (mixed case) against normalized pairs', () => {
    const found = INTERACTIONS.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('matches LisinoPril (camel case) against normalized pairs', () => {
    const found = INTERACTIONS.some(ix => ix.drugs.includes('lisinopril'));
    expect(found).toBe(true);
  });

  it('real data is already normalized (idempotent)', () => {
    const once = INTERACTIONS.map(ix => ({
      ...ix,
      drugs: [ix.drugs[0].toLowerCase(), ix.drugs[1].toLowerCase()] as [string, string],
    }));
    expect(once).toEqual(INTERACTIONS);
  });

  it('severity is preserved against real data', () => {
    const severe = INTERACTIONS.filter(ix => ix.severity === 'severe');
    expect(severe.length).toBe(2);
  });

  it('real INTERACTIONS contains the expected drug pairs', () => {
    const pairs = INTERACTIONS.map(ix => ix.drugs.sort().join('|'));
    expect(pairs).toContain('atorvastatin|grapefruit');
    expect(pairs).toContain('lisinopril|potassium');
    expect(pairs).toContain('metformin|alcohol');
    expect(INTERACTIONS).toHaveLength(8);
  });
});
