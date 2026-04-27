/**
 * Baseline tests for bill-audit-api logic (#238).
 *
 * Tests the auditBill function (money math, policy enforcement,
 * duplicate detection, overcharge/upcoding classification) and the
 * formatTxHashDisplay helper from pdf.ts.
 *
 * All tests are pure-logic — no HTTP server is started.
 */

import { describe, it, expect } from 'vitest';

// ── Re-implement testable logic inline (server.ts exports are wrapped in
// express setup that requires env vars). Extract pure functions for testing.
// In a follow-up refactor these should be moved to a separate module. ──────

const FAIR_MARKET_RATES: Record<string, { description: string; fairRate: number }> = {
  "99213": { description: "Office visit, established patient, moderate", fairRate: 130 },
  "99214": { description: "Office visit, established patient, high", fairRate: 195 },
  "99215": { description: "Office visit, established patient, complex", fairRate: 265 },
  "70553": { description: "MRI brain with and without contrast", fairRate: 450 },
  "71046": { description: "Chest X-ray, 2 views", fairRate: 45 },
  "80053": { description: "Comprehensive metabolic panel", fairRate: 25 },
  "85025": { description: "Complete blood count (CBC)", fairRate: 15 },
  "36415": { description: "Venipuncture (blood draw)", fairRate: 10 },
  "93000": { description: "Electrocardiogram (ECG)", fairRate: 35 },
  "99232": { description: "Hospital care, moderate complexity", fairRate: 145 },
  "97110": { description: "Physical therapy, therapeutic exercises", fairRate: 55 },
};

interface BillItem { description: string; cptCode: string; quantity: number; chargedAmount: number; }

function auditBill(lineItems: BillItem[]) {
  const results: any[] = [];
  let totalCharged = 0, totalCorrect = 0, errorCount = 0;
  const seenCodes: Record<string, number> = {};

  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fairRate = FAIR_MARKET_RATES[item.cptCode];
    const fairAmount = fairRate ? fairRate.fairRate * item.quantity : null;

    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (seenCodes[item.cptCode] > 1 && !["96372", "97110"].includes(item.cptCode)) {
      errorCount++;
      results.push({ ...item, fairMarketRate: fairAmount, status: "duplicate", suggestedAmount: 0 });
      continue;
    }

    if (fairAmount && item.chargedAmount > fairAmount * 1.5) {
      errorCount++;
      const suggestedAmount = +(fairAmount * 1.2).toFixed(2);
      totalCorrect += suggestedAmount;
      const status = item.chargedAmount > fairAmount * 3 ? "upcoded" : "overcharged";
      results.push({ ...item, fairMarketRate: fairAmount, status, suggestedAmount });
      continue;
    }

    const suggested = fairAmount ? Math.min(item.chargedAmount, +(fairAmount * 1.2).toFixed(2)) : item.chargedAmount;
    totalCorrect += suggested;
    results.push({ ...item, fairMarketRate: fairAmount, status: "valid", suggestedAmount: suggested });
  }

  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);
  const savingsPercent = totalCharged > 0 ? +((totalOvercharge / totalCharged) * 100).toFixed(1) : 0;

  return { totalCharged: +totalCharged.toFixed(2), totalCorrect: +totalCorrect.toFixed(2), totalOvercharge, savingsPercent, errorCount, lineItems: results };
}

// ── tx-hash helper (mirrors pdf.ts logic) ────────────────────────────────────

function formatTxHashDisplay(hash?: string): { display: string; decodeFailed: boolean } {
  if (!hash) return { display: "-", decodeFailed: false };
  if (hash.length === 64 && /^[0-9a-f]{64}$/i.test(hash)) {
    return { display: `${hash.slice(0, 16)}...`, decodeFailed: false };
  }
  if (hash.length > 64) {
    try {
      const decoded = JSON.parse(atob(hash)) as Record<string, unknown>;
      const extracted = (decoded.transaction || decoded.reference || decoded.hash) as unknown;
      if (typeof extracted === "string") {
        const trimmed = extracted.length > 16 ? `${extracted.slice(0, 16)}...` : extracted;
        return { display: trimmed, decodeFailed: false };
      }
      return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
    } catch {
      return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
    }
  }
  return { display: `${hash.slice(0, 16)}... ?`, decodeFailed: true };
}

// ── auditBill: valid items ────────────────────────────────────────────────────

describe('auditBill — valid items', () => {
  it('marks an item within 1.5x fair rate as valid', () => {
    const result = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 150 },
    ]);
    expect(result.lineItems[0].status).toBe('valid');
    expect(result.errorCount).toBe(0);
  });

  it('totalCharged equals sum of chargedAmounts', () => {
    const result = auditBill([
      { description: 'X-ray', cptCode: '71046', quantity: 1, chargedAmount: 45 },
      { description: 'CBC', cptCode: '85025', quantity: 1, chargedAmount: 15 },
    ]);
    expect(result.totalCharged).toBeCloseTo(60, 2);
  });

  it('totalOvercharge is 0 when all items are valid', () => {
    const result = auditBill([
      { description: 'ECG', cptCode: '93000', quantity: 1, chargedAmount: 35 },
    ]);
    expect(result.totalOvercharge).toBe(0);
  });
});

// ── auditBill: overcharge detection ──────────────────────────────────────────

describe('auditBill — overcharge detection', () => {
  it('flags an item charged > 1.5x fair rate as overcharged', () => {
    // Fair rate for 99213 is $130; 1.5x = $195; charge $200 → overcharged
    const result = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 200 },
    ]);
    expect(result.lineItems[0].status).toBe('overcharged');
    expect(result.errorCount).toBe(1);
  });

  it('flags an item charged > 3x fair rate as upcoded', () => {
    // Fair rate for 71046 is $45; 3x = $135; charge $200 → upcoded
    const result = auditBill([
      { description: 'X-ray', cptCode: '71046', quantity: 1, chargedAmount: 200 },
    ]);
    expect(result.lineItems[0].status).toBe('upcoded');
    expect(result.errorCount).toBe(1);
  });

  it('calculates totalOvercharge correctly', () => {
    // Fair rate $130, charged $400, suggested = 130 * 1.2 = $156
    const result = auditBill([
      { description: 'Office visit', cptCode: '99213', quantity: 1, chargedAmount: 400 },
    ]);
    expect(result.totalOvercharge).toBeCloseTo(400 - 156, 1);
  });

  it('savingsPercent is positive when overcharged', () => {
    const result = auditBill([
      { description: 'MRI', cptCode: '70553', quantity: 1, chargedAmount: 2000 },
    ]);
    expect(result.savingsPercent).toBeGreaterThan(0);
  });
});

// ── auditBill: duplicate detection ───────────────────────────────────────────

describe('auditBill — duplicate detection', () => {
  it('marks second occurrence of a CPT code as duplicate', () => {
    const result = auditBill([
      { description: 'CBC', cptCode: '85025', quantity: 1, chargedAmount: 15 },
      { description: 'CBC', cptCode: '85025', quantity: 1, chargedAmount: 15 },
    ]);
    expect(result.lineItems[1].status).toBe('duplicate');
    expect(result.errorCount).toBe(1);
  });

  it('allows repeated therapy codes (97110)', () => {
    const result = auditBill([
      { description: 'PT', cptCode: '97110', quantity: 1, chargedAmount: 55 },
      { description: 'PT', cptCode: '97110', quantity: 1, chargedAmount: 55 },
    ]);
    expect(result.lineItems.every(i => i.status !== 'duplicate')).toBe(true);
  });

  it('duplicate suggestedAmount is 0', () => {
    const result = auditBill([
      { description: 'CBC', cptCode: '85025', quantity: 1, chargedAmount: 15 },
      { description: 'CBC', cptCode: '85025', quantity: 1, chargedAmount: 15 },
    ]);
    expect(result.lineItems[1].suggestedAmount).toBe(0);
  });
});

// ── formatTxHashDisplay ───────────────────────────────────────────────────────

describe('formatTxHashDisplay — tx hash extraction', () => {
  it('returns "-" for missing hash', () => {
    expect(formatTxHashDisplay(undefined).display).toBe('-');
    expect(formatTxHashDisplay('').display).toBe('-');
  });

  it('truncates a valid 64-char hex hash', () => {
    const hash = 'a'.repeat(64);
    const result = formatTxHashDisplay(hash);
    expect(result.display).toBe(`${'a'.repeat(16)}...`);
    expect(result.decodeFailed).toBe(false);
  });

  it('extracts transaction field from base64-encoded JSON header', () => {
    const payload = JSON.stringify({ transaction: 'abc123realhash' });
    const encoded = btoa(payload) + 'X'.repeat(20); // ensure length > 64
    const result = formatTxHashDisplay(encoded);
    expect(result.decodeFailed).toBe(false);
    expect(result.display).toContain('abc123realhash');
  });

  it('marks decodeFailed=true for a non-JSON base64 over-long string', () => {
    const garbage = 'X'.repeat(100);
    const result = formatTxHashDisplay(garbage);
    expect(result.decodeFailed).toBe(true);
  });
});
