import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardHeader } from "../components/dashboard-header";
import type { FetchSourceHealth } from "../hooks/fetch-health";

const recipient = {
  name: "Rosa Garcia",
  age: 78,
};

const healthySources: FetchSourceHealth[] = [
  { id: "agent-info", label: "Agent info", error: null, lastSuccessAt: 1 },
  { id: "spending", label: "Spending", error: null, lastSuccessAt: 1 },
  { id: "transactions", label: "Transactions", error: null, lastSuccessAt: 1 },
];

function renderHeader(fetchHealthSources: FetchSourceHealth[]) {
  return render(
    <DashboardHeader
      recipient={recipient}
      recipientInitials="RG"
      agentInfo={null}
      agentConnected={true}
      agentPaused={false}
      walletBalance={null}
      fetchHealthSources={fetchHealthSources}
      onTogglePause={vi.fn()}
    />,
  );
}

describe("DashboardHeader fetch health", () => {
  it("shows a healthy chip when all sources are successful", () => {
    renderHeader(healthySources);

    const chip = screen.getByLabelText("Data source health");
    expect(chip.textContent).toContain("Data healthy");
    expect(chip.className).toContain("bg-green-50");
    expect(chip.getAttribute("title")).toContain("Agent info");
  });

  it("turns red and explains which source failed", () => {
    renderHeader([
      healthySources[0],
      {
        id: "spending",
        label: "Spending",
        error: "Spending failed (500)",
        lastSuccessAt: null,
      },
      healthySources[2],
    ]);

    const chip = screen.getByLabelText("Data source health");
    expect(chip.textContent).toContain("Data issue");
    expect(chip.className).toContain("bg-red-50");
    expect(chip.getAttribute("title")).toContain("Spending");
    expect(chip.getAttribute("title")).toContain("Spending failed (500)");
  });
});
