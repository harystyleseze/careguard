/**
 * Tests for Issue #1259 — pending-approvals badge on the Approvals tab in
 * DashboardTabsNav.
 *
 * Verifies:
 *  1. The badge shows the pending count when it exists.
 *  2. The badge disappears when the queue is empty or the count is not
 *     provided (optional prop).
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DashboardTabsNav } from "../components/dashboard-tabs-nav";

function renderNav(approvalsCount?: number) {
  return render(
    <DashboardTabsNav activeTab="overview" pathname="/" approvalsCount={approvalsCount} />,
  );
}

describe("DashboardTabsNav — approvals badge (Issue #1259)", () => {
  it("shows the pending count on the Approvals tab", () => {
    renderNav(3);
    const badge = screen.getByTestId("approvals-badge");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("3");
    expect(screen.getByLabelText("3 pending approvals")).toBeTruthy();
  });

  it("does not render the badge when the queue is empty", () => {
    renderNav(0);
    expect(screen.queryByTestId("approvals-badge")).toBeNull();
  });

  it("does not render the badge when no count is provided", () => {
    renderNav();
    expect(screen.queryByTestId("approvals-badge")).toBeNull();
  });
});
