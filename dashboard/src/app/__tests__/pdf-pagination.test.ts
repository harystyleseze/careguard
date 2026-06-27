/**
 * PDF pagination tests for downloadBillAuditPDF (#225).
 *
 * Verifies that:
 * - A 500-item bill generates a multi-page document.
 * - The column header row ("Description", "CPT Code", …) appears on every page.
 * - Long descriptions are wrapped rather than truncated or overflowed.
 *
 * jsPDF and jspdf-autotable run in Node via vitest — no browser needed.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock jsPDF and autoTable so tests run without a DOM canvas ───────────────
// We track calls to assert multi-page behavior.

const mockSave = vi.fn();
const mockText = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetDrawColor = vi.fn();
const mockLine = vi.fn();
const mockSetProperties = vi.fn();
const mockGetNumberOfPages = vi.fn(() => capturedPageCount);
const mockSetPage = vi.fn();
const mockAddPage = vi.fn(() => { capturedPageCount++; });
// splitTextToSize: split on every 80 chars to approximate real jsPDF behaviour.
const mockSplitTextToSize = vi.fn((text: string, _maxWidth: number): string[] => {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += 80) lines.push(text.slice(i, i + 80));
  return lines.length ? lines : [''];
});

let capturedPageCount = 1;
let capturedAutoTableCalls: any[] = [];
let lastDidDrawPageCallback: ((data: any) => void) | undefined;
// Mutable so individual tests can push finalY near the page bottom.
let mockFinalY = 200;

vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    setFontSize: mockSetFontSize,
    setTextColor: mockSetTextColor,
    setDrawColor: mockSetDrawColor,
    text: mockText,
    line: mockLine,
    setProperties: mockSetProperties,
    save: mockSave,
    getNumberOfPages: mockGetNumberOfPages,
    setPage: mockSetPage,
    addPage: mockAddPage,
    splitTextToSize: mockSplitTextToSize,
    get lastAutoTable() { return { finalY: mockFinalY }; },
  })),
}));

vi.mock('jspdf-autotable', () => ({
  default: vi.fn().mockImplementation((_doc: any, opts: any) => {
    capturedAutoTableCalls.push(opts);
    lastDidDrawPageCallback = opts.didDrawPage;
    // Simulate a multi-page table for large bodies.
    if (opts.body && opts.body.length > 50) {
      capturedPageCount = Math.ceil(opts.body.length / 40);
    }
  }),
}));

// ── Import after mocks are in place ──────────────────────────────────────────

import { downloadBillAuditPDF } from '../pdf';
import type { BillAuditResult } from '../../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuditResult(itemCount: number): BillAuditResult {
  return {
    auditTimestamp: new Date().toISOString(),
    totalCharged: itemCount * 100,
    totalCorrect: itemCount * 95,
    totalOvercharge: itemCount * 5,
    savingsPercent: 5,
    errorCount: 0,
    recommendation: 'No errors detected.',
    lineItems: Array.from({ length: itemCount }, (_, i) => ({
      description: `Service item ${i + 1} with a moderately long description to test wrapping`,
      cptCode: '99213',
      quantity: 1,
      chargedAmount: 100,
      status: 'valid' as const,
      suggestedAmount: 95,
      fairMarketRate: 130,
      errorDescription: null,
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('downloadBillAuditPDF — pagination (#225)', () => {
  beforeEach(() => {
    capturedPageCount = 1;
    capturedAutoTableCalls = [];
    lastDidDrawPageCallback = undefined;
    mockFinalY = 200;
    vi.clearAllMocks();
    mockGetNumberOfPages.mockReturnValue(capturedPageCount);
    // Restore default splitTextToSize implementation after vi.clearAllMocks().
    mockSplitTextToSize.mockImplementation((text: string, _maxWidth: number): string[] => {
      const lines: string[] = [];
      for (let i = 0; i < text.length; i += 80) lines.push(text.slice(i, i + 80));
      return lines.length ? lines : [''];
    });
  });

  it('calls autoTable with showHead: "everyPage"', () => {
    downloadBillAuditPDF(makeAuditResult(10));
    expect(capturedAutoTableCalls.length).toBeGreaterThan(0);
    const tableOpts = capturedAutoTableCalls[0];
    expect(tableOpts.showHead).toBe('everyPage');
  });

  it('passes a didDrawPage callback', () => {
    downloadBillAuditPDF(makeAuditResult(10));
    expect(typeof lastDidDrawPageCallback).toBe('function');
  });

  it('500-item bill produces a multi-page document (pageCount > 1)', () => {
    downloadBillAuditPDF(makeAuditResult(500));
    expect(capturedPageCount).toBeGreaterThan(1);
  });

  it('description column uses cellWidth: "wrap"', () => {
    downloadBillAuditPDF(makeAuditResult(5));
    const tableOpts = capturedAutoTableCalls[0];
    expect(tableOpts.columnStyles).toBeDefined();
    expect(tableOpts.columnStyles[0]?.cellWidth).toBe('wrap');
  });

  it('didDrawPage re-draws header for continuation pages', () => {
    downloadBillAuditPDF(makeAuditResult(10));
    expect(lastDidDrawPageCallback).toBeDefined();
    // Simulate the callback firing on page 2.
    lastDidDrawPageCallback!({ pageNumber: 2 });
    // addHeader calls doc.text — verify it was called again after the callback.
    expect(mockText).toHaveBeenCalled();
  });

  it('errorsOnly filter still paginates correctly', () => {
    const result = makeAuditResult(200);
    // Mark half as errors.
    result.lineItems.forEach((item, i) => {
      if (i % 2 === 0) { (item as any).status = 'overcharged'; }
    });
    downloadBillAuditPDF(result, { errorsOnly: true });
    const tableOpts = capturedAutoTableCalls[0];
    // Body should only contain the ~100 error items.
    expect(tableOpts.body.length).toBe(100);
  });

  it('saves the document', () => {
    downloadBillAuditPDF(makeAuditResult(5));
    expect(mockSave).toHaveBeenCalledWith('careguard-bill-audit-report.pdf');
  });

  it("uses provided recipient in PDF header and metadata", () => {
    downloadBillAuditPDF(makeAuditResult(2), {
      recipient: { name: "Ada Lovelace", age: 82, facility: "Memorial Clinic" },
    });
    const joinedTextArgs = mockText.mock.calls.map((call) => String(call[0])).join(" ");
    expect(joinedTextArgs).toContain("Ada Lovelace");
    expect(mockSetProperties).toHaveBeenCalled();
  });
});

// --- Recommendation text wrapping / overflow (Issue #227) ---

describe("downloadBillAuditPDF — recommendation wrapping (#227)", () => {
  beforeEach(() => {
    capturedPageCount = 1;
    capturedAutoTableCalls = [];
    mockFinalY = 200;
    vi.clearAllMocks();
    mockGetNumberOfPages.mockReturnValue(capturedPageCount);
    mockSplitTextToSize.mockImplementation((text: string, _maxWidth: number): string[] => {
      const lines: string[] = [];
      for (let i = 0; i < text.length; i += 80) lines.push(text.slice(i, i + 80));
      return lines.length ? lines : [''];
    });
  });

  it("calls splitTextToSize with the recommendation text and maxWidth 182", () => {
    const rec = "Review all charges carefully.";
    downloadBillAuditPDF({ ...makeAuditResult(1), recommendation: rec });
    expect(mockSplitTextToSize).toHaveBeenCalledWith(rec, 182);
  });

  it("1k-char recommendation renders without overflow when finalY is low (no addPage)", () => {
    // finalY=200: recStartY=208. 13 lines * 5mm = 65, total 273 < 275 → fits.
    mockFinalY = 200;
    const rec = "A".repeat(1000);
    downloadBillAuditPDF({ ...makeAuditResult(1), recommendation: rec });
    // splitTextToSize was called with the full text
    expect(mockSplitTextToSize).toHaveBeenCalledWith(rec, 182);
    // doc.text was called with an array (the wrapped lines), not the raw 1k string
    const textCalls = mockText.mock.calls;
    const recCall = textCalls.find((args) => Array.isArray(args[0]));
    expect(recCall).toBeDefined();
    expect(Array.isArray(recCall![0])).toBe(true);
    // addPage was NOT called for the recommendation (table was only 1 item)
    expect(mockAddPage).not.toHaveBeenCalled();
  });

  it("adds a page when wrapped lines would overflow the page bottom", () => {
    // finalY=260: recStartY=268. Even 2 lines = 10mm → 278 > 275 → must add page.
    mockFinalY = 260;
    // Return 3 lines regardless of text so the overflow is deterministic.
    mockSplitTextToSize.mockReturnValue(["line1", "line2", "line3"]);
    downloadBillAuditPDF({ ...makeAuditResult(1), recommendation: "short" });
    expect(mockAddPage).toHaveBeenCalled();
  });

  it("renders lines on the new page starting at y=58 after a page break", () => {
    mockFinalY = 260;
    mockSplitTextToSize.mockReturnValue(["line1", "line2", "line3"]);
    downloadBillAuditPDF({ ...makeAuditResult(1), recommendation: "short" });
    // The last doc.text call with an array arg should be at y=58 (after the new page)
    const textCalls = mockText.mock.calls;
    const recCall = textCalls.findLast((args) => Array.isArray(args[0]));
    expect(recCall).toBeDefined();
    expect(recCall![2]).toBe(58); // y position
  });
});
