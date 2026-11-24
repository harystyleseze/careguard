/**
 * Spending-by-category chart in the wallet tab (#1185).
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { SpendingCategoryChart, categoryRows } from "../components/spending-category-chart";
import { WalletTab } from "../components/tabs/wallet-tab";
import type { SpendingData } from "../components/types";

const totals = (medications: number, bills: number, serviceFees: number) => ({
  medications, bills, serviceFees, total: medications + bills + serviceFees, count: 1,
});

function spending(withBreakdown = true): SpendingData {
  return {
    policy: { dailyLimit: 100, monthlyLimit: 500, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 75, holdTimeSeconds: 86400 },
    spending: { medications: 60, bills: 120, serviceFees: 0.5, total: 180.5 },
    budgetRemaining: { medications: 240, bills: 380 },
    transactionCount: 4,
    recentTransactions: [],
    ...(withBreakdown
      ? { categoryBreakdown: { "7d": totals(10, 0, 0), "30d": totals(30, 90, 0), all: totals(60, 120, 0.5) } }
      : {}),
  } as SpendingData;
}

describe("SpendingCategoryChart (#1185)", () => {
  it("labels every category with its amount and share, not colour alone", () => {
    render(<SpendingCategoryChart spending={spending()} />);
    const meds = within(screen.getByTestId("category-medications"));
    expect(meds.getByText("Pharmacy (medications)")).toBeTruthy();
    expect(meds.getByText("$30.00", { exact: false })).toBeTruthy();
    expect(meds.getByText("(25%)")).toBeTruthy();
    expect(within(screen.getByTestId("category-bills")).getByText("(75%)")).toBeTruthy();
  });

  it("switches totals with the time range", async () => {
    render(<SpendingCategoryChart spending={spending()} />);
    const thirty = screen.getByRole("radio", { name: "30 days" });
    expect(thirty.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(within(screen.getByTestId("category-medications")).getByText("(100%)")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(within(screen.getByTestId("category-bills")).getByText("$120.00", { exact: false })).toBeTruthy();
  });

  it("shows an empty state when a range has no completed payments", async () => {
    const data = spending();
    data.categoryBreakdown!["7d"] = totals(0, 0, 0);
    render(<SpendingCategoryChart spending={data} />);
    await userEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(screen.getByText("No completed payments in this period.")).toBeTruthy();
  });

  it("works with the existing get_spending_summary shape (no categoryBreakdown)", () => {
    render(<SpendingCategoryChart spending={spending(false)} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(within(screen.getByTestId("category-bills")).getByText("$120.00", { exact: false })).toBeTruthy();
    expect(screen.getByText(/only reports all-time totals/)).toBeTruthy();
  });

  it("categoryRows computes shares that sum to 100", () => {
    const { rows, total } = categoryRows(spending(), "all", { medications: "m", bills: "b", serviceFees: "f" });
    expect(total).toBeCloseTo(180.5);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100);
  });

  it("is rendered by the wallet tab when spending data is available", () => {
    render(<WalletTab agentInfo={null} walletBalance="1.00" walletXlm="1.00" walletBalanceState="ok" spending={spending()} />);
    expect(screen.getByRole("heading", { name: "Spending by Category" })).toBeTruthy();
  });
});
