/// <reference types="@testing-library/jest-dom" />
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OverviewTab } from "./overview-tab";

// Mock AdherencePrompt since it does fetching
vi.mock("./overview-tab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./overview-tab")>();
  return {
    ...actual,
    AdherencePrompt: () => <div data-testid="adherence-prompt" />,
  };
});

describe("OverviewTab Component", () => {
  const mockProps = {
    spending: {
      policy: {
        dailyLimit: 1000,
        monthlyLimit: 2000,
        medicationMonthlyBudget: 500,
        billMonthlyBudget: 500,
        approvalThreshold: 100,
        holdTimeSeconds: 86400,
      },
      spending: {
        medications: 150,
        bills: 200,
        serviceFees: 0.05,
        total: 350.05,
      },
      budgetRemaining: {
        medications: 350,
        bills: 300,
      },
      transactionCount: 5,
      recentTransactions: [],
    },
    agentResult: null,
    agentPaused: false,
    loading: false,
    activeTask: "",
    onRunTask: vi.fn(),
    onCancelTask: vi.fn(),
  };

  it("renders spending and budget cards", () => {
    render(<OverviewTab {...mockProps} />);
    expect(screen.getByText("$350.05")).toBeInTheDocument();
    expect(screen.getByText("of $2000 limit")).toBeInTheDocument();
    expect(screen.getByText("Agent API Costs")).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();
    expect(screen.getByText("5 queries via x402")).toBeInTheDocument();
  });

  it("displays agent results when provided", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "I found $10.00 in savings.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [
            { tool: "compare_pharmacy_prices", input: { drug_name: "lisinopril" }, result: { potentialSavings: 10.0 } },
          ],
          llmUsage: { promptTokens: 100, completionTokens: 50 },
        }}
      />
    );
    expect(screen.getByText("$10.00/mo")).toBeInTheDocument();
    expect(screen.getByText("150 tokens")).toBeInTheDocument();
    expect(screen.getByText("I found $10.00 in savings.")).toBeInTheDocument();
  });

  it("shows the iteration-limit banner when the run was capped (Issue #165)", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "Partial result.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [],
          events: [{ kind: "iteration_limit_reached" }],
        }}
      />
    );
    expect(
      screen.getByText(/Task may be incomplete — agent ran out of steps/i)
    ).toBeInTheDocument();
  });

  it("does not show the iteration-limit banner on a normal run (Issue #165)", () => {
    render(
      <OverviewTab
        {...mockProps}
        agentResult={{
          response: "Done.",
          spending: { spending: { serviceFees: 0.05 } } as any,
          toolCalls: [],
          events: [],
        }}
      />
    );
    expect(
      screen.queryByText(/agent ran out of steps/i)
    ).not.toBeInTheDocument();
  });

  it("calls onRunTask when task buttons are clicked", () => {
    render(<OverviewTab {...mockProps} />);

    const medsBtn = screen.getByRole("button", { name: /Compare Medication Prices/i });
    fireEvent.click(medsBtn);
    expect(mockProps.onRunTask).toHaveBeenCalledWith(
      expect.stringContaining("Compare prices for all of Rosa's medications"),
      "meds"
    );

    const billBtn = screen.getByRole("button", { name: /Audit Hospital Bill/i });
    fireEvent.click(billBtn);
    expect(mockProps.onRunTask).toHaveBeenCalledWith(
      expect.stringContaining("Audit Rosa's hospital bill"),
      "bill"
    );
  });
});
