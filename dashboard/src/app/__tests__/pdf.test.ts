/**
 * Smoke tests for dashboard/src/app/pdf.ts (issue #50).
 *
 * Tests all three PDF generators:
 *   - downloadBillAuditPDF
 *   - downloadMedicationPDF
 *   - downloadTransactionPDF
 *
 * Verifies: no throws, correct text anchors, table structure,
 * header/footer rendered, savings line, interactions table, truncated tx hash.
 *
 * jsPDF and jspdf-autotable are mocked — no browser/canvas needed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mock jsPDF ────────────────────────────────────────────────────────────────
const mockSave = vi.fn();
const mockText = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetDrawColor = vi.fn();
const mockLine = vi.fn();
const mockSetProperties = vi.fn();
const mockAddPage = vi.fn();
const mockSetPage = vi.fn();
let mockPageCount = 1;
const mockGetNumberOfPages = vi.fn(() => mockPageCount);

vi.mock("jspdf", () => ({
  default: vi.fn().mockImplementation(() => ({
    setFontSize: mockSetFontSize,
    setTextColor: mockSetTextColor,
    setDrawColor: mockSetDrawColor,
    text: mockText,
    line: mockLine,
    setProperties: mockSetProperties,
    save: mockSave,
    addPage: mockAddPage,
    setPage: mockSetPage,
    getNumberOfPages: mockGetNumberOfPages,
    lastAutoTable: { finalY: 150 },
  })),
}));

// ── Mock jspdf-autotable ──────────────────────────────────────────────────────
let capturedAutoTableCalls: any[] = [];

vi.mock("jspdf-autotable", () => ({
  default: vi.fn().mockImplementation((_doc: any, opts: any) => {
    capturedAutoTableCalls.push(opts);
  }),
}));

// ── Import under test ─────────────────────────────────────────────────────────
import { downloadBillAuditPDF, downloadMedicationPDF, downloadTransactionPDF } from "../pdf";
import type { BillAuditResult, PharmacyCompareResult, DrugInteractionResult } from "../../lib/types";
import type { Transaction, SpendingData } from "../../lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBillAuditResult(errorCount = 2): BillAuditResult {
  return {
    auditTimestamp: new Date().toISOString(),
    totalCharged: 2500,
    totalCorrect: 1800,
    totalOvercharge: 700,
    savingsPercent: 28,
    errorCount,
    recommendation:
      errorCount > 0
        ? `Found ${errorCount} errors totaling $700 in overcharges. Strongly recommend filing a formal dispute.`
        : "No errors detected.",
    lineItems: [
      {
        description: "Hospital care, high complexity",
        cptCode: "99233",
        quantity: 3,
        chargedAmount: 630,
        status: "valid",
        suggestedAmount: 522,
        fairMarketRate: 435,
        errorDescription: null,
      },
      {
        description: "Complete blood count (CBC) — duplicate",
        cptCode: "85025",
        quantity: 1,
        chargedAmount: 45,
        status: "duplicate",
        suggestedAmount: 0,
        fairMarketRate: 15,
        errorDescription: "Duplicate CPT 85025",
      },
      {
        description: "Office visit, complex",
        cptCode: "99215",
        quantity: 1,
        chargedAmount: 1250,
        status: "upcoded",
        suggestedAmount: 318,
        fairMarketRate: 265,
        errorDescription: "Charged $1250 — fair rate $265",
      },
    ],
  };
}

function makePharmacyResults(): PharmacyCompareResult[] {
  return [
    {
      drug: "Lisinopril",
      prices: [
        { pharmacyName: "Costco", price: 3.5, distance: "2.1 mi", inStock: true },
        { pharmacyName: "CVS", price: 12.99, distance: "0.5 mi", inStock: true },
      ],
      cheapest: { pharmacyName: "Costco", price: 3.5, distance: "2.1 mi", inStock: true },
      mostExpensive: { pharmacyName: "CVS", price: 12.99 },
      potentialSavings: 9.49,
      savingsPercent: 73.1,
    },
    {
      drug: "Metformin",
      prices: [
        { pharmacyName: "Walmart", price: 4.0, distance: "1.8 mi", inStock: true },
        { pharmacyName: "Walgreens", price: 13.49, distance: "0.8 mi", inStock: true },
      ],
      cheapest: { pharmacyName: "Walmart", price: 4.0, distance: "1.8 mi", inStock: true },
      potentialSavings: 9.49,
      savingsPercent: 70.3,
    },
  ];
}

function makeInteractionResult(): DrugInteractionResult {
  return {
    summary: "Found 1 interaction(s): 1 severe, 0 moderate, 0 mild.",
    interactions: [
      {
        drug1: "Lisinopril",
        drug2: "Potassium",
        severity: "severe",
        recommendation: "Monitor potassium levels",
      },
    ],
  };
}

function makeTransactions(): Transaction[] {
  return [
    {
      id: "tx-001",
      timestamp: new Date().toISOString(),
      type: "medication",
      description: "Lisinopril from Costco [MPP Charge]",
      amount: 3.5,
      recipient: "costco-001",
      stellarTxHash: "a".repeat(64),
      status: "completed",
      category: "medications",
    },
    {
      id: "tx-002",
      timestamp: new Date().toISOString(),
      type: "service_fee",
      description: "x402 query: pharmacy prices for Metformin",
      amount: 0.002,
      recipient: "pharmacy-price-api",
      status: "completed",
      category: "service_fees",
    },
  ];
}

function makeSpending(): SpendingData {
  return {
    policy: {
      dailyLimit: 100,
      monthlyLimit: 500,
      medicationMonthlyBudget: 300,
      billMonthlyBudget: 500,
      approvalThreshold: 75,
    },
    spending: { medications: 3.5, bills: 0, serviceFees: 0.002, total: 3.502 },
    budgetRemaining: { medications: 296.5, bills: 500 },
    transactionCount: 2,
    recentTransactions: makeTransactions(),
  };
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  capturedAutoTableCalls = [];
  mockPageCount = 1;
  mockGetNumberOfPages.mockImplementation(() => mockPageCount);
});

// ── downloadBillAuditPDF ──────────────────────────────────────────────────────

describe("downloadBillAuditPDF", () => {
  it("does not throw with a canonical audit fixture", () => {
    expect(() => downloadBillAuditPDF(makeBillAuditResult())).not.toThrow();
  });

  it('writes "CareGuard" to the PDF header', () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain("CareGuard");
  });

  it("writes the total charged amount to the PDF", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toContain("2500");
  });

  it("passes all line items to autoTable body", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    expect(capturedAutoTableCalls.length).toBeGreaterThan(0);
    const tableOpts = capturedAutoTableCalls[0];
    expect(tableOpts.body.length).toBe(3);
  });

  it("includes DUPLICATE status in autoTable body", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const body = capturedAutoTableCalls[0].body as any[][];
    const statusCells = body.map((row) => row[4]);
    expect(statusCells).toContain("DUPLICATE");
  });

  it("includes UPCODED status in autoTable body", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const body = capturedAutoTableCalls[0].body as any[][];
    const statusCells = body.map((row) => row[4]);
    expect(statusCells).toContain("UPCODED");
  });

  it("writes the recommendation text", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toMatch(/dispute|No errors/i);
  });

  it("calls addFooter — sets page count text on every page", () => {
    mockPageCount = 2;
    mockGetNumberOfPages.mockReturnValue(2);
    downloadBillAuditPDF(makeBillAuditResult());
    // addFooter calls doc.setPage for each page
    expect(mockSetPage).toHaveBeenCalledWith(1);
    expect(mockSetPage).toHaveBeenCalledWith(2);
  });

  it("saves with the correct filename", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    expect(mockSave).toHaveBeenCalledWith("careguard-bill-audit-report.pdf");
  });

  it("uses custom recipient in header and metadata", () => {
    downloadBillAuditPDF(makeBillAuditResult(), {
      recipient: { name: "Ada Lovelace", age: 82, facility: "Test Clinic" },
    });
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toContain("Ada Lovelace");
  });

  it("errorsOnly filter passes only error items to autoTable", () => {
    downloadBillAuditPDF(makeBillAuditResult(), { errorsOnly: true });
    const body = capturedAutoTableCalls[0].body as any[][];
    // 2 errors (duplicate + upcoded), 1 valid filtered out
    expect(body.length).toBe(2);
  });

  it("sets document properties with CareGuard as author", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    expect(mockSetProperties).toHaveBeenCalledWith(
      expect.objectContaining({ author: "CareGuard" })
    );
  });
});

// ── downloadMedicationPDF ─────────────────────────────────────────────────────

describe("downloadMedicationPDF", () => {
  it("does not throw with canonical fixtures", () => {
    expect(() =>
      downloadMedicationPDF(
        { priceResults: makePharmacyResults(), interactionResult: makeInteractionResult() }
      )
    ).not.toThrow();
  });

  it("writes total savings line to the PDF", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toMatch(/Total Potential Savings/i);
  });

  it("renders one autoTable per drug (2 drugs → 2 price tables)", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    // One table per drug (no interactions)
    expect(capturedAutoTableCalls.length).toBe(2);
  });

  it("renders an extra interactions table when interactions are present", () => {
    downloadMedicationPDF({
      priceResults: makePharmacyResults(),
      interactionResult: makeInteractionResult(),
    });
    // 2 price tables + 1 interactions table = 3
    expect(capturedAutoTableCalls.length).toBe(3);
  });

  it("interactions table body contains severity and recommendation", () => {
    downloadMedicationPDF({
      priceResults: makePharmacyResults(),
      interactionResult: makeInteractionResult(),
    });
    const interactionTable = capturedAutoTableCalls[capturedAutoTableCalls.length - 1];
    const body = interactionTable.body as any[][];
    expect(body[0]).toContain("severe");
    expect(body[0]).toContain("Monitor potassium levels");
  });

  it("does NOT render an interactions table when there are no interactions", () => {
    downloadMedicationPDF({
      priceResults: makePharmacyResults(),
      interactionResult: { summary: "No interactions found.", interactions: [] },
    });
    expect(capturedAutoTableCalls.length).toBe(2);
  });

  it("price table body marks cheapest pharmacy as first row", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    // First drug table — first row = cheapest (Costco $3.5)
    const firstTable = capturedAutoTableCalls[0];
    const firstRow = firstTable.body[0] as any[];
    expect(firstRow).toContain("Costco");
    expect(firstRow).toContain("$3.5");
  });

  it("saves with the correct filename", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    expect(mockSave).toHaveBeenCalledWith("careguard-medication-report.pdf");
  });

  it("calls addFooter — page count text rendered", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    expect(mockSetPage).toHaveBeenCalledWith(1);
  });

  it("sets document properties", () => {
    downloadMedicationPDF({ priceResults: makePharmacyResults() });
    expect(mockSetProperties).toHaveBeenCalledWith(
      expect.objectContaining({ author: "CareGuard" })
    );
  });
});

// ── downloadTransactionPDF ────────────────────────────────────────────────────

describe("downloadTransactionPDF", () => {
  it("does not throw with canonical fixtures", () => {
    expect(() =>
      downloadTransactionPDF(makeTransactions(), makeSpending())
    ).not.toThrow();
  });

  it("passes one row per transaction to autoTable", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const tableOpts = capturedAutoTableCalls[0];
    expect(tableOpts.body.length).toBe(2);
  });

  it("truncates Stellar tx hash to 16 chars + ellipsis in the table", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const body = capturedAutoTableCalls[0].body as any[][];
    const txCol = body[0][5] as string; // Stellar Tx column
    // 64-char hash → first 16 chars + "..."
    expect(txCol).toBe("a".repeat(16) + "...");
  });

  it("shows '-' for transactions without a stellar hash", () => {
    const txs = makeTransactions();
    delete (txs[1] as any).stellarTxHash;
    downloadTransactionPDF(txs, makeSpending());
    const body = capturedAutoTableCalls[0].body as any[][];
    expect(body[1][5]).toBe("-");
  });

  it("writes spending summary totals to the PDF", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toContain("3.50");
    expect(texts).toContain("Total");
  });

  it("renders without spending data (null)", () => {
    expect(() => downloadTransactionPDF(makeTransactions(), null)).not.toThrow();
  });

  it("saves with the correct filename", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    expect(mockSave).toHaveBeenCalledWith("careguard-transaction-report.pdf");
  });

  it("calls addFooter — page and footer text rendered", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    expect(mockSetPage).toHaveBeenCalledWith(1);
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toContain("CareGuard");
  });

  it("sets document properties with correct subject", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const props = (mockSetProperties.mock.calls[0][0] as any);
    expect(props.author).toBe("CareGuard");
    expect(props.title).toContain("Transaction");
  });

  it('renders "CareGuard" header text on the page', () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const texts = mockText.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain("CareGuard");
  });
});

// ── addHeader / addFooter (via all three generators) ─────────────────────────

describe("addHeader + addFooter (via all generators)", () => {
  it("addHeader writes 'AI Healthcare Agent on Stellar' subtitle", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain("AI Healthcare Agent on Stellar");
  });

  it("addHeader writes a 'Generated:' timestamp line", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toMatch(/Generated:/);
  });

  it("addFooter writes stellar.expert attribution", () => {
    downloadTransactionPDF(makeTransactions(), makeSpending());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toContain("stellar.expert");
  });

  it("addFooter writes 'Page 1 of N' text", () => {
    downloadBillAuditPDF(makeBillAuditResult());
    const texts = mockText.mock.calls.map((c) => String(c[0])).join(" ");
    expect(texts).toMatch(/Page \d+ of \d+/);
  });
});
