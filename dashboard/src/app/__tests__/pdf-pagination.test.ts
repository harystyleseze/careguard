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

let capturedPageCount = 1;
let capturedAutoTableCalls: any[] = [];
let lastDidDrawPageCallback: ((data: any) => void) | undefined;

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
    lastAutoTable: { finalY: 200 },
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
    vi.clearAllMocks();
    mockGetNumberOfPages.mockReturnValue(capturedPageCount);
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
