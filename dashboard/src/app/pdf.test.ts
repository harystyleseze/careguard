/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Patch fs before pdf-parse gets imported to avoid the CWD-relative test file error
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (this: any, filePath: any, options?: any) {
  if (typeof filePath === "string" && filePath.includes("05-versions-space.pdf")) {
    const resolvedPath = path.resolve("node_modules/pdf-parse/test/data/05-versions-space.pdf");
    return originalReadFileSync.call(this, resolvedPath, options);
  }
  return originalReadFileSync.apply(this, [filePath, options]);
};

const originalWriteFileSync = fs.writeFileSync;
fs.writeFileSync = function (this: any, filePath: any, data: any, options?: any) {
  if (typeof filePath === "string" && filePath.includes("05-versions-space.pdf")) {
    return;
  }
  return originalWriteFileSync.apply(this, [filePath, data, options]);
};

import { downloadBillAuditPDF, downloadMedicationPDF, downloadTransactionPDF } from "./pdf";
import type { BillAuditResult, PharmacyCompareResult, Transaction, SpendingData } from "../lib/types";

let capturedBuffer: Buffer | null = null;

vi.mock("jspdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("jspdf")>();
  const jsPDFClass = original.default || original.jsPDF;

  class MockedjsPDF extends jsPDFClass {
    constructor(...args: any[]) {
      super(...args);
      this.save = function (this: any, filename: string) {
        const arrayBuffer = this.output("arraybuffer");
        capturedBuffer = Buffer.from(arrayBuffer);
        return this;
      };
    }
  }

  return {
    ...original,
    default: MockedjsPDF,
    jsPDF: MockedjsPDF,
  };
});

describe("PDF Report Snapshot Tests", () => {
  let pdfParse: any;

  beforeEach(async () => {
    capturedBuffer = null;
    if (!pdfParse) {
      pdfParse = (await import("pdf-parse")).default;
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-27T08:38:42.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should generate a correct Bill Audit PDF report", async () => {
    const mockAudit: BillAuditResult = {
      auditTimestamp: "2026-06-27T08:00:00.000Z",
      totalCharged: 1200,
      totalCorrect: 1000,
      totalOvercharge: 200,
      errorCount: 2,
      savingsPercent: 16.67,
      recommendation: "Review the duplicated CPT codes at General Hospital.",
      lineItems: [
        {
          description: "Comprehensive office visit",
          cptCode: "99214",
          quantity: 1,
          chargedAmount: 150,
          status: "valid" as const,
          suggestedAmount: 150,
          fairMarketRate: 150,
          errorDescription: null,
        },
        {
          description: "Electrocardiogram report",
          cptCode: "93000",
          quantity: 2,
          chargedAmount: 100,
          status: "duplicate" as const,
          suggestedAmount: 50,
          fairMarketRate: 50,
          errorDescription: "Duplicated electrocardiogram billing item.",
        },
      ],
    };

    downloadBillAuditPDF(mockAudit);
    expect(capturedBuffer).not.toBeNull();

    const parsed = await pdfParse(capturedBuffer!);
    expect(parsed.numpages).toBe(1);

    // Assert canonical anchors
    expect(parsed.text).toContain("CareGuard");
    expect(parsed.text).toContain("Medical Bill Audit Report");
    expect(parsed.text).toContain("Total Charged: $1200");
    expect(parsed.text).toContain("Overcharges Found: $200");
    expect(parsed.text).toContain("Corrected Amount: $1000");
    expect(parsed.text).toContain("2 errors found");
    expect(parsed.text).toContain("Comprehensive office visit");
    expect(parsed.text).toContain("Electrocardiogram report");
    expect(parsed.text).toContain("99214");
    expect(parsed.text).toContain("93000");
    expect(parsed.text).toContain("Review the duplicated CPT codes at General Hospital.");

    // Match exact text snapshot
    expect(parsed.text).toMatchSnapshot();
  });

  it("should generate a correct Medication Price Comparison PDF report", async () => {
    const priceResults: PharmacyCompareResult[] = [
      {
        drug: "Lisinopril 10mg",
        cheapest: { pharmacyName: "Costco", price: 10, distance: "2.1 miles", inStock: true },
        mostExpensive: { pharmacyName: "CVS", price: 45, distance: "1.2 miles", inStock: true },
        potentialSavings: 35,
        savingsPercent: 77.78,
        prices: [
          { pharmacyName: "Costco", price: 10, distance: "2.1 miles", inStock: true },
          { pharmacyName: "CVS", price: 45, distance: "1.2 miles", inStock: true },
        ],
      },
    ];

    const interactionResult = {
      summary: "Moderate risk detected",
      interactions: [
        {
          drug1: "Lisinopril",
          drug2: "Metformin",
          severity: "Moderate",
          recommendation: "Monitor blood pressure regularly.",
        },
      ],
    };

    downloadMedicationPDF({ priceResults, interactionResult });
    expect(capturedBuffer).not.toBeNull();

    const parsed = await pdfParse(capturedBuffer!);
    expect(parsed.numpages).toBe(1);

    // Assert anchors
    expect(parsed.text).toContain("Total Potential Savings: $35.00/month");
    expect(parsed.text).toContain("Lisinopril 10mg");
    expect(parsed.text).toContain("Costco");
    expect(parsed.text).toContain("CVS");
    expect(parsed.text).toContain("Drug Interactions");
    expect(parsed.text).toContain("Lisinopril");
    expect(parsed.text).toContain("Metformin");
    expect(parsed.text).toContain("Monitor blood pressure regularly.");

    expect(parsed.text).toMatchSnapshot();
  });

  it("should generate a correct Transaction PDF report", async () => {
    const transactions: Transaction[] = [
      {
        id: "tx_1",
        timestamp: "2026-06-27T08:00:00.000Z",
        type: "medication" as const,
        description: "Lisinopril purchase at Costco",
        amount: 10.00,
        recipient: "Rosa Garcia",
        stellarTxHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        status: "completed",
        category: "medication",
      },
    ];

    const spending: SpendingData = {
      policy: {
        dailyLimit: 2000,
        monthlyLimit: 5000,
        medicationMonthlyBudget: 500,
        billMonthlyBudget: 4000,
        approvalThreshold: 1000,
      },
      spending: {
        medications: 10.00,
        bills: 0.00,
        serviceFees: 0.0300,
        total: 10.03,
      },
      budgetRemaining: {
        medications: 490.00,
        bills: 4000.00,
      },
      transactionCount: 1,
      recentTransactions: transactions,
    };

    downloadTransactionPDF(transactions, spending);
    expect(capturedBuffer).not.toBeNull();

    const parsed = await pdfParse(capturedBuffer!);
    expect(parsed.numpages).toBe(1);

    // Assert anchors
    expect(parsed.text).toContain("Transaction Report");
    expect(parsed.text).toContain("Medications: $10.00");
    expect(parsed.text).toContain("Bills: $0.00");
    expect(parsed.text).toContain("Lisinopril purchase at Costco");
    expect(parsed.text).toContain("a1b2c3d4e5f6a1b2");

    expect(parsed.text).toMatchSnapshot();
  });
});
