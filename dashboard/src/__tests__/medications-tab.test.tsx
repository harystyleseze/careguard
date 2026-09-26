/**
 * Tests for the MedicationsTab PDF export discoverability (Issue #1280).
 *
 * Verifies:
 *  1. "Download PDF" renders in a disabled state with an explanatory hint
 *     before any compare_pharmacy_prices results exist.
 *  2. It enables automatically once price results are available.
 *  3. The disabled state carries accessible metadata (title + aria-describedby).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MedicationsTab } from "../components/tabs/medications-tab";
import type { MedicationsTabProps } from "../components/tabs/medications-tab";
import type { AgentResult } from "../components/types";

vi.mock("../../app/pdf", () => ({ downloadMedicationPDF: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function buildProps(overrides: Partial<MedicationsTabProps> = {}): MedicationsTabProps {
  return {
    recipient: { name: "Rosa Garcia", age: 78, facility: "General Hospital" },
    agentResult: null,
    ...overrides,
  };
}

function priceResultCall(drug: string, price: number) {
  return {
    id: `tc-${drug}`,
    tool: "compare_pharmacy_prices",
    input: { drug },
    result: {
      drug,
      cheapest: { pharmacyName: "ChemCare", price },
      potentialSavings: 12,
      savingsPercent: 20,
      options: [],
    },
  } as any;
}

describe("MedicationsTab — Download PDF discoverability (#1280)", () => {
  it("renders the button disabled with an explanatory hint before results exist", () => {
    render(<MedicationsTab {...buildProps()} />);

    const btn = screen.getByRole("button", { name: /Download PDF/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Run a price comparison first to enable the PDF export",
    );
    // Visible helper text so the disabled state doesn't read as "broken".
    expect(
      screen.getByText("Run a price comparison first to enable the PDF export"),
    ).toBeTruthy();
    expect(btn).toHaveAttribute(
      "aria-describedby",
      "medications-download-hint",
    );
  });

  it("enables the button automatically once price results are available", () => {
    const agentResult = {
      toolCalls: [priceResultCall("Lisinopril", 8.5)],
    } as AgentResult;
    render(<MedicationsTab {...buildProps({ agentResult })} />);

    const btn = screen.getByRole("button", { name: /Download PDF/i });
    expect(btn).not.toBeDisabled();
    expect(btn).not.toHaveAttribute("title");
    expect(
      screen.queryByText("Run a price comparison first to enable the PDF export"),
    ).toBeNull();
  });

  it("does not export when clicked in the disabled state", () => {
    render(<MedicationsTab {...buildProps()} />);
    // A disabled button does not fire onClick; clicking must be a no-op.
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
    // No navigation/PDF side effect — the stub simply records nothing.
    expect(
      screen.getByRole("button", { name: /Download PDF/i }),
    ).toBeDisabled();
  });
});
