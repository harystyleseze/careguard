import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MedicationsTab } from "../components/tabs/medications-tab";
import type { AgentResult } from "../components/types";

const spending = {
  policy: {
    dailyLimit: 100,
    monthlyLimit: 800,
    medicationMonthlyBudget: 300,
    billMonthlyBudget: 500,
    approvalThreshold: 75,
    holdTimeSeconds: 0,
  },
  spending: {
    medications: 0,
    bills: 0,
    serviceFees: 0,
    total: 0,
  },
  budgetRemaining: {
    medications: 300,
    bills: 500,
  },
  transactionCount: 0,
  recentTransactions: [],
};

function buildResult(toolCalls: AgentResult["toolCalls"]): AgentResult {
  return {
    response: "",
    toolCalls,
    spending,
  };
}

function renderMedications(toolCalls: AgentResult["toolCalls"]) {
  return render(
    <MedicationsTab
      agentResult={buildResult(toolCalls)}
      recipient={{ name: "Rosa Garcia" }}
    />,
  );
}

describe("MedicationsTab interaction groups", () => {
  it("does not render an interactions panel when there are no interaction calls", () => {
    renderMedications([]);

    expect(screen.queryByText("Drug Interactions")).toBeNull();
  });

  it("separates the summary from a single interaction card", () => {
    const { container } = renderMedications([
      {
        id: "interaction-1",
        tool: "check_drug_interactions",
        input: { drug: "metformin" },
        result: {
          summary: "One interaction was found.",
          interactions: [
            {
              drug1: "metformin",
              drug2: "ibuprofen",
              severity: "moderate",
              recommendation: "Ask the pharmacist before combining them.",
            },
          ],
        },
      },
    ]);

    const summary = screen.getByText("One interaction was found.");
    const group = summary.parentElement;
    expect(group?.className).toContain("rounded-lg");
    expect(group?.className).toContain("border-slate-200");
    expect(group?.querySelector(".border-t")).not.toBeNull();
    expect(container.querySelector(".bg-amber-50")).not.toBeNull();
  });

  it("keeps a summary-only interaction call readable", () => {
    renderMedications([
      {
        id: "interaction-empty",
        tool: "check_drug_interactions",
        input: { drug: "lisinopril" },
        result: {
          summary: "No interactions were found.",
          interactions: [],
        },
      },
    ]);

    expect(screen.getByText("No interactions were found.")).toBeTruthy();
    expect(screen.queryByText(/metformin \+ ibuprofen/)).toBeNull();
  });

  it("delineates multiple interaction groups and preserves severity colors", () => {
    renderMedications([
      {
        id: "interaction-1",
        tool: "check_drug_interactions",
        input: { drug: "metformin" },
        result: {
          summary: "First interaction summary.",
          interactions: [
            {
              drug1: "metformin",
              drug2: "ibuprofen",
              severity: "severe",
              recommendation: "Avoid this combination.",
            },
          ],
        },
      },
      {
        id: "interaction-2",
        tool: "check_drug_interactions",
        input: { drug: "lisinopril" },
        result: {
          summary: "Second interaction summary.",
          interactions: [
            {
              drug1: "lisinopril",
              drug2: "ibuprofen",
              severity: "mild",
              recommendation: "Monitor for symptoms.",
            },
          ],
        },
      },
    ]);

    const summaries = screen.getAllByText(/interaction summary\./i);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].parentElement).not.toBe(summaries[1].parentElement);
    expect(screen.getByText(/metformin \+ ibuprofen/)).toBeTruthy();
    expect(screen.getByText(/lisinopril \+ ibuprofen/)).toBeTruthy();
    expect(document.querySelector(".bg-red-50")).not.toBeNull();
    expect(document.querySelector(".bg-blue-50")).not.toBeNull();
  });
});
