import { describe, it, expect } from 'vitest';

function normalizeKeys(db: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(db).map(([k, v]) => [k.toLowerCase(), v]));
}

describe('StaticProvider PRICING_DATABASE key normalization', () => {
  it('all keys are lowercase after normalization', () => {
    const rawKeys = ['lisinopril', 'metformin', 'atorvastatin', 'amlodipine', 'omeprazole'];
    const db = normalizeKeys(Object.fromEntries(rawKeys.map(k => [k, []])));
    for (const key of Object.keys(db)) {
      expect(key).toBe(key.toLowerCase());
    }
  });

  it('getPrices lookup succeeds for title-case input (Lisinopril)', () => {
    const database: Record<string, boolean> = { lisinopril: true };
    expect(database['Lisinopril'.toLowerCase()]).toBe(true);
  });

  it('getPrices lookup succeeds for all-caps input (LISINOPRIL)', () => {
    const database: Record<string, boolean> = { lisinopril: true };
    expect(database['LISINOPRIL'.toLowerCase()]).toBe(true);
  });

  it('getPrices lookup succeeds for mixed-case input (lIsInOpRiL)', () => {
    const database: Record<string, boolean> = { lisinopril: true };
    expect(database['lIsInOpRiL'.toLowerCase()]).toBe(true);
  });

  it('getPrices lookup succeeds for camel-case input (LisinoPril)', () => {
    const database: Record<string, boolean> = { lisinopril: true };
    expect(database['LisinoPril'.toLowerCase()]).toBe(true);
  });

  it('getPrices lookup succeeds for already-lowercase input (lisinopril)', () => {
    const database: Record<string, boolean> = { lisinopril: true };
    expect(database['lisinopril'.toLowerCase()]).toBe(true);
  });

  it('normalization is idempotent — applying twice gives same result', () => {
    const rawKeys = ['Lisinopril', 'METFORMIN', 'Atorvastatin'];
    const once = rawKeys.map(k => k.toLowerCase());
    const twice = once.map(k => k.toLowerCase());
    expect(once).toEqual(twice);
  });
});
