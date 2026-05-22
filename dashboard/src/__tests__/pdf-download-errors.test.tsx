import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityTab } from "../components/tabs/activity-tab";
import { BillsTab } from "../components/tabs/bills-tab";
import { MedicationsTab } from "../components/tabs/medications-tab";

vi.mock("jspdf", () => ({
  default: vi.fn(() => {
    throw new Error("jsPDF load failed");
  }),
}));

vi.mock("jspdf-autotable", () => ({
  default: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => [{ index: 0, size: 80, start: 0 }],
    getTotalSize: () => 80,
  })),
}));

const recipient = { name: "Rosa Garcia", age: 78 };

const spending = {
  policy: {
    dailyLimit: 100,
    monthlyLimit: 500,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
  },
  spending: {
    medications: 10,
    bills: 20,
    serviceFees: 0.01,
    total: 30.01,
  },
  budgetRemaining: {
    medications: 290,
    bills: 480,
  },
  transactionCount: 1,
  recentTransactions: [],
};

function expectPdfFailureToast() {
  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("Couldn't generate PDF — try again");
  expect(toast).toHaveTextContent(/Request ID: pdf-/);
}

describe("PDF download error handling", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a request-id toast when medication PDF generation fails", () => {
    render(
      <MedicationsTab
        recipient={recipient}
        agentResult={{
          response: "",
          spending,
          toolCalls: [
            {
              tool: "compare_pharmacy_prices",
              input: {},
              result: {
                drug: "Lisinopril",
                prices: [{ pharmacyName: "Pharmacy A", price: 12 }],
                cheapest: { pharmacyName: "Pharmacy A", price: 12 },
                mostExpensive: { pharmacyName: "Pharmacy B", price: 24 },
                potentialSavings: 12,
                savingsPercent: 50,
              },
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    expectPdfFailureToast();
  });

  it("shows a request-id toast when bill PDF generation fails", () => {
    render(
      <BillsTab
        recipient={recipient}
        agentResult={{
          response: "",
          spending,
          toolCalls: [
            {
              tool: "audit_medical_bill",
              input: {},
              result: {
                totalCharged: 200,
                totalCorrect: 150,
                totalOvercharge: 50,
                errorCount: 1,
                lineItems: [
                  {
                    description: "Duplicate line item",
                    quantity: 1,
                    chargedAmount: 200,
                    status: "duplicate",
                    suggestedAmount: 150,
                    errorDescription: "Duplicate charge",
                  },
                ],
                recommendation: "Ask billing to correct the duplicate charge.",
              },
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));

    expectPdfFailureToast();
  });

  it("shows a request-id toast when transaction PDF generation fails", () => {
    render(
      <ActivityTab
        recipient={recipient}
        agentLog={[]}
        setAgentLog={vi.fn()}
        allTransactions={[
          {
            id: "tx-1",
            timestamp: "2026-05-22T06:00:00.000Z",
            type: "bill",
            description: "Hospital bill payment",
            amount: 20,
            recipient: "Rosa Garcia",
            status: "completed",
            category: "bills",
          },
        ]}
        pagination={null}
        currentPage={0}
        setCurrentPage={vi.fn()}
        pageSize={10}
        setPageSize={vi.fn()}
        spending={spending}
        onResetAgent={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download Report" }));

    expectPdfFailureToast();
  });
});
