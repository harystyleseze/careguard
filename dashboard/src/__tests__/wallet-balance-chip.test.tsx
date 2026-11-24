/**
 * Tests for Issue #1258 — wallet balance chip keeps its layout space while
 * loading or unavailable instead of vanishing.
 *
 * Verifies:
 *  1. A skeleton placeholder (with the wallet label) is rendered when the
 *     balance or agent wallet is not yet available.
 *  2. The real balance with the Stellar explorer link is rendered once data
 *     is present.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DashboardHeader } from "../components/dashboard-header";
import type { DashboardHeaderProps } from "../components/dashboard-header";

const baseProps: DashboardHeaderProps = {
  recipient: { name: "Rosa Martinez", age: 72 } as any,
  recipientInitials: "RM",
  agentInfo: null,
  agentConnected: true,
  agentPaused: false,
  walletBalance: null,
  onTogglePause: vi.fn(),
};

describe("DashboardHeader — wallet balance chip (Issue #1258)", () => {
  it("renders a placeholder block (label + skeleton) while the balance is loading", () => {
    const { container } = render(<DashboardHeader {...baseProps} />);
    const placeholder = screen.getByTestId("wallet-balance-placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder.textContent).toContain("Agent Wallet (USDC)");
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
    expect(screen.queryByTestId("wallet-balance-link")).toBeNull();
  });

  it("renders a placeholder when the agent wallet is unavailable", () => {
    render(
      <DashboardHeader {...baseProps} walletBalance="25.00" agentInfo={null} />,
    );
    expect(screen.getByTestId("wallet-balance-placeholder")).toBeTruthy();
    expect(screen.queryByTestId("wallet-balance-link")).toBeNull();
  });

  it("renders the balance with the explorer link once data is present", () => {
    render(
      <DashboardHeader
        {...baseProps}
        walletBalance="25.00"
        agentInfo={{ service: "agent", agentWallet: "GABC", llm: "mock", network: "testnet" }}
      />,
    );
    const link = screen.getByTestId("wallet-balance-link");
    expect(link.getAttribute("href")).toContain("GABC");
    expect(link.textContent).toContain("$25.00");
    expect(screen.queryByTestId("wallet-balance-placeholder")).toBeNull();
  });
});
