/**
 * Cumulative Stellar network fee card on the wallet tab (#1232).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NetworkFeesCard } from "../components/network-fees-card";
import type { SpendingData } from "../components/types";

const summary = (overrides: Partial<NonNullable<SpendingData["networkFees"]>["all"]> = {}) => ({
  totalStroops: 2300,
  totalXlm: 0.00023,
  count: 4,
  averageStroops: 575,
  maxStroops: 2000,
  typicalStroops: 100,
  trend: [
    { date: "2026-10-17", stroops: 200, count: 2, averageStroops: 100, spike: false },
    { date: "2026-10-18", stroops: 0, count: 0, averageStroops: 0, spike: false },
    { date: "2026-10-19", stroops: 2100, count: 2, averageStroops: 1050, spike: true },
  ],
  spikeDays: 1,
  ...overrides,
});

const spending = {
  policy: { dailyLimit: 100, monthlyLimit: 1000, medicationMonthlyBudget: 300, billMonthlyBudget: 500, approvalThreshold: 75, holdTimeSeconds: 0 },
  spending: { medications: 10, bills: 20, serviceFees: 0.01, total: 30.01 },
  budgetRemaining: { medications: 290, bills: 480 },
  transactionCount: 4,
  recentTransactions: [],
  networkFees: {
    "7d": summary({ totalXlm: 0.0001, count: 1, trend: [], spikeDays: 0 }),
    "30d": summary(),
    all: summary({ totalXlm: 0.005 }),
  },
} as unknown as SpendingData;

describe("NetworkFeesCard (#1232)", () => {
  it("shows the cumulative XLM total separately from spending, defaulting to 30 days", () => {
    render(<NetworkFeesCard spending={spending} />);
    expect(screen.getByText("Stellar Network Fees")).toBeTruthy();
    expect(screen.getByTestId("network-fees-total").textContent).toBe("0.00023 XLM");
  });

  it("switches range with the same 7d / 30d / all filter as the spending breakdown", () => {
    render(<NetworkFeesCard spending={spending} />);
    fireEvent.click(screen.getByRole("radio", { name: "All time" }));
    expect(screen.getByTestId("network-fees-total").textContent).toBe("0.005 XLM");
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(screen.getByTestId("network-fees-total").textContent).toBe("0.0001 XLM");
  });

  it("marks fee spikes in the trend and explains them in text", () => {
    render(<NetworkFeesCard spending={spending} />);
    expect(screen.getAllByTestId("fee-spike-day")).toHaveLength(1);
    expect(screen.getByText(/1 day\(s\) had fees at least 2× the typical 100 stroops/)).toBeTruthy();
  });

  it("explains when the agent doesn't report network fees", () => {
    render(<NetworkFeesCard spending={{ ...spending, networkFees: undefined }} />);
    expect(screen.getByText("This agent doesn't report network fees yet.")).toBeTruthy();
  });
});
