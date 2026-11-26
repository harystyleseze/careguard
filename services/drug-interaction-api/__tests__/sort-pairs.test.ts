import { describe, it, expect } from 'vitest';
import { sortPairsBySeverity } from '../logic.ts';

/**
 * Sort drug interaction pairs by severity (severe > moderate > mild)
 * and alphabetically by drug name for equal severities.
 * Severity order: severe (0) > moderate (1) > mild (2)
 */

describe('sortPairsBySeverity', () => {
  it('should sort by severity: severe > moderate > mild', () => {
    const pairs = [
      { drug1: 'drug_a', drug2: 'drug_b', severity: 'mild', description: 'mild interaction' },
      { drug1: 'drug_c', drug2: 'drug_d', severity: 'severe', description: 'severe interaction' },
      { drug1: 'drug_e', drug2: 'drug_f', severity: 'moderate', description: 'moderate interaction' },
    ];

    const sorted = sortPairsBySeverity(pairs);

    expect(sorted[0].severity).toBe('severe');
    expect(sorted[1].severity).toBe('moderate');
    expect(sorted[2].severity).toBe('mild');
  });

  it('should sort equal severities alphabetically by drug names', () => {
    const pairs = [
      { drug1: 'Zoloft', drug2: 'Alcohol', severity: 'moderate', description: 'interaction 1' },
      { drug1: 'Alcohol', drug2: 'Aspirin', severity: 'moderate', description: 'interaction 2' },
      { drug1: 'Metformin', drug2: 'Insulin', severity: 'moderate', description: 'interaction 3' },
    ];

    const sorted = sortPairsBySeverity(pairs);

    // After sorting alphabetically by drug pair:
    // Alcohol|Aspirin, Insulin|Metformin, Alcohol|Zoloft
    expect(sorted[0].drug1).toBe('Alcohol');
    expect(sorted[0].drug2).toBe('Aspirin');
  });

  it('should handle a mix of severity levels and alphabetical sorting', () => {
    const pairs = [
      { drug1: 'Lisinopril', drug2: 'Potassium', severity: 'severe', description: 'hyperkalemia risk' },
      { drug1: 'Metformin', drug2: 'Alcohol', severity: 'severe', description: 'lactic acidosis' },
      { drug1: 'Amlodipine', drug2: 'Atorvastatin', severity: 'mild', description: 'slight interaction' },
      { drug1: 'Atorvastatin', drug2: 'Grapefruit', severity: 'moderate', description: 'increased levels' },
      { drug1: 'Lisinopril', drug2: 'Ibuprofen', severity: 'moderate', description: 'NSAID interaction' },
      { drug1: 'Metformin', drug2: 'Atorvastatin', severity: 'mild', description: 'blood sugar' },
    ];

    const sorted = sortPairsBySeverity(pairs);

    // All severes should come first
    expect(sorted[0].severity).toBe('severe');
    expect(sorted[1].severity).toBe('severe');

    // Then moderates
    expect(sorted[2].severity).toBe('moderate');
    expect(sorted[3].severity).toBe('moderate');

    // Then milds
    expect(sorted[4].severity).toBe('mild');
    expect(sorted[5].severity).toBe('mild');

    // Within same severity, should be alphabetical
    const severeKeys = [
      [sorted[0].drug1, sorted[0].drug2].sort().join('|'),
      [sorted[1].drug1, sorted[1].drug2].sort().join('|'),
    ];
    expect(severeKeys[0] < severeKeys[1] || severeKeys[0] === severeKeys[1]).toBe(true);
  });

  it('should handle empty list', () => {
    const pairs: any[] = [];
    const sorted = sortPairsBySeverity(pairs);
    expect(sorted).toEqual([]);
  });

  it('should handle single pair', () => {
    const pairs = [{ drug1: 'drug_a', drug2: 'drug_b', severity: 'severe' }];
    const sorted = sortPairsBySeverity(pairs);
    expect(sorted.length).toBe(1);
    expect(sorted[0].severity).toBe('severe');
  });

  it('should handle unknown severity values', () => {
    const pairs = [
      { drug1: 'drug_a', drug2: 'drug_b', severity: 'unknown' },
      { drug1: 'drug_c', drug2: 'drug_d', severity: 'severe' },
    ];

    const sorted = sortPairsBySeverity(pairs);

    // Severe should come first (0), unknown should be last (3)
    expect(sorted[0].severity).toBe('severe');
    expect(sorted[1].severity).toBe('unknown');
  });

  it('should not mutate the input array (Issue #914)', () => {
    const original = [
      { drug1: 'Zoloft', drug2: 'Alcohol', severity: 'moderate', description: 'interaction 1' },
      { drug1: 'Aspirin', drug2: 'Warfarin', severity: 'severe', description: 'interaction 2' },
      { drug1: 'Metformin', drug2: 'Insulin', severity: 'mild', description: 'interaction 3' },
    ];
    // Store original order for comparison
    const originalOrder = original.map(p => ({ drug1: p.drug1, drug2: p.drug2, severity: p.severity }));

    const sorted = sortPairsBySeverity(original);

    // Input array should remain unchanged
    expect(original.map(p => ({ drug1: p.drug1, drug2: p.drug2, severity: p.severity }))).toEqual(originalOrder);
    // Sorted array should be different (sorted by severity)
    expect(sorted[0].severity).toBe('severe');
    expect(sorted[1].severity).toBe('moderate');
    expect(sorted[2].severity).toBe('mild');
  });
});
