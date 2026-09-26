/**
 * React tests for BillsTab — line-item sort control (Issue #1274),
 * recommendation callout (Issue #1255) and dispute-generation feedback
 * (Issue #1256).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { BillsTab } from "../components/tabs/bills-tab";
import type { AgentResult } from "../components/types";
import type { RecipientProfile, SpendingData } from "../lib/types";

const { toastSuccess, downloadDisputeLetterPDF, downloadBillAuditPDF, downloadDisputeLetterEmail } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  downloadDisputeLetterPDF: vi.fn(),
  downloadBillAuditPDF: vi.fn(),
  downloadDisputeLetterEmail: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

vi.mock("../app/pdf", () => ({
  downloadBillAuditPDF,
  downloadDisputeLetterPDF,
  downloadDisputeLetterEmail,
}));


const recipient: RecipientProfile = { name: "Rosa" };

const spending: SpendingData = {
  policy: {
    dailyLimit: 100,
    monthlyLimit: 500,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 50,
    holdTimeSeconds: 86400,
  },
  spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
  budgetRemaining: { medications: 300, bills: 500 },
  transactionCount: 0,
  recentTransactions: [],
};

function buildAgentResult(): AgentResult {
  return {
    response: "Audit complete",
    toolCalls: [
      {
        id: "call-1",
        tool: "audit_medical_bill",
        input: {},
        result: {
          totalCharged: 900,
          totalCorrect: 700,
          totalOvercharge: 200,
          errorCount: 2,
          recommendation: "Dispute the flagged items.",
          lineItems: [
            {
              description: "Small overcharge",
              cptCode: "111",
              chargedAmount: 120,
              status: "upcoded",
              suggestedAmount: 100,
            },
            {
              description: "Large overcharge",
              cptCode: "222",
              chargedAmount: 300,
              status: "duplicate",
              suggestedAmount: 150,
            },
            {
              description: "Valid line",
              cptCode: "333",
              chargedAmount: 80,
              status: "valid",
              suggestedAmount: 80,
            },
          ],
        },
      },
    ],
    spending,
  };
}

function descriptionOrder(): string[] {
  return screen
    .getAllByTestId("line-item")
    .map((el: HTMLElement) => el.querySelector(".font-medium")?.textContent || "");
}

describe("BillsTab — line item sort control (Issue #1274)", () => {
  it("keeps original order by default", () => {
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);
    expect(descriptionOrder()).toEqual([
      "Small overcharge",
      "Large overcharge",
      "Valid line",
    ]);
  });

  it("sorts by overcharge amount descending when the sort control is toggled on", async () => {
    const user = userEvent.setup();
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);
    await user.click(screen.getByRole("button", { name: /sort by overcharge/i }));
    expect(descriptionOrder()).toEqual([
      "Large overcharge",
      "Small overcharge",
      "Valid line",
    ]);
  });

  it("preserves the errors-only filter alongside sorting", async () => {
    const user = userEvent.setup();
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);
    await user.click(screen.getByRole("button", { name: /sort by overcharge/i }));
    await user.click(screen.getByRole("button", { name: /show errors only/i }));
    expect(descriptionOrder()).toEqual(["Large overcharge", "Small overcharge"]);
  });

  it("returns to default order when sort is toggled back off", async () => {
    const user = userEvent.setup();
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);
    const sortBtn = screen.getByRole("button", { name: /sort by overcharge/i });
    await user.click(sortBtn);
    await user.click(screen.getByRole("button", { name: /default order/i }));
    expect(descriptionOrder()).toEqual([
      "Small overcharge",
      "Large overcharge",
      "Valid line",
    ]);
  });
});

describe("BillsTab — recommendation callout (Issue #1255)", () => {
  it("renders the recommendation in a prioritized callout above the metrics", () => {
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);

    const callout = screen.getByRole("note", { name: /audit recommendation/i });
    expect(callout).toBeInTheDocument();
    expect(callout.textContent).toContain("Dispute the flagged items.");

    // The callout sits before the metric tiles in the card.
    const totalChargedTile = screen.getByText("Total Charged");
    expect(callout.compareDocumentPosition(totalChargedTile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the line items table below the recommendation", () => {
    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);

    const callout = screen.getByRole("note", { name: /audit recommendation/i });
    const firstLineItem = screen.getAllByTestId("line-item")[0]!;
    expect(callout.compareDocumentPosition(firstLineItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders nothing for the callout when the recommendation is empty", () => {
    const result = buildAgentResult();
    result.toolCalls[0]!.result.recommendation = "";
    render(<BillsTab agentResult={result} recipient={recipient} />);

    expect(screen.queryByRole("note", { name: /audit recommendation/i })).not.toBeInTheDocument();
    // The rest of the card still renders.
    expect(screen.getAllByTestId("line-item").length).toBeGreaterThan(0);
  });

  it("renders very long recommendation text without truncation", () => {
    const result = buildAgentResult();
    const longText = "Dispute ".repeat(200) + "the flagged items.";
    result.toolCalls[0]!.result.recommendation = longText;
    render(<BillsTab agentResult={result} recipient={recipient} />);

    const callout = screen.getByRole("note", { name: /audit recommendation/i });
    expect(callout.textContent).toContain(longText);
  });
});

describe("BillsTab — dispute generation feedback (Issue #1256)", () => {
  it("shows a spinner during generation and toasts when the download starts", async () => {
    const user = userEvent.setup();
    let resolveDownload: () => void = () => {};
    downloadDisputeLetterPDF.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveDownload = resolve; }),
    );

    render(<BillsTab agentResult={buildAgentResult()} recipient={recipient} />);
    const disputeBtn = screen.getByRole("button", { name: /dispute/i });
    await user.click(disputeBtn);

    // Spinner + Generating... label while the PDF builds.
    const generating = screen.getByRole("button", { name: /generating/i });
    expect(generating).toBeDisabled();
    expect(generating.querySelector(".animate-spin")).not.toBeNull();

    resolveDownload();

    // Button returns to its normal label promptly after completion.
    await screen.findByRole("button", { name: /^Dispute$/i });
    expect(screen.getByRole("button", { name: /^Dispute$/i })).not.toBeDisabled();
    expect(toastSuccess).toHaveBeenCalledWith("Dispute letter PDF downloaded");
  });
});
