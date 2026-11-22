/**
 * "Why did this happen?" reasoning view (#1235).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WhyDidThisHappen, type ActionReasoning } from "../components/why-did-this-happen";

const reasoning: ActionReasoning = {
  id: "run-1:1",
  createdAt: "2026-10-19T12:00:00Z",
  kind: "payment_pending_approval",
  title: "Bill payment held for approval",
  outcome: "Held the $250.00 bill from General Hospital for a caregiver's approval instead of paying it.",
  steps: [
    { tool: "fetch_and_audit_bill", summary: "Audited the bill and found no billing errors." },
    { tool: "pay_bill", summary: "Held the $250.00 bill for approval." },
  ],
  dataPoints: [
    { label: "Amount", value: "$250.00" },
    { label: "Approval threshold", value: "$75.00" },
  ],
  transactionId: "tx-1",
};

describe("WhyDidThisHappen (#1235)", () => {
  it("expands to a plain-language trace of tools and key data", () => {
    render(<WhyDidThisHappen reasoning={reasoning} />);
    fireEvent.click(screen.getByText("Why did this happen?"));
    expect(screen.getByText("Bill payment held for approval")).toBeTruthy();
    expect(screen.getByText("Audited the bill and found no billing errors.")).toBeTruthy();
    expect(screen.getByText("Approval threshold")).toBeTruthy();
    expect(screen.getByText("$75.00")).toBeTruthy();
  });
});
