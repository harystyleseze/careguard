import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsTab } from "../components/tabs/approvals-tab";
import type { Transaction } from "../lib/types";

const APPROVAL: Transaction = {
  id: "approval-1",
  timestamp: "2026-07-29T10:00:00.000Z",
  type: "bill",
  description: "Hospital bill",
  amount: 80,
  recipient: "Rosa",
  status: "pending",
  category: "bills",
};

describe("ApprovalsTab", () => {
  it("renders approvals from props and delegates approve and cancel actions", () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);

    render(
      <ApprovalsTab
        agentConnected
        approvals={[APPROVAL]}
        loading={false}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Hospital bill")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApprove).toHaveBeenCalledWith("approval-1");
    expect(onCancel).toHaveBeenCalledWith("approval-1");
  });

  it("renders exception requests with a single-action approval flow", () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const exceptionTx = {
      ...APPROVAL,
      id: "exception-1",
      description: "Unexpected specialist bill",
      amount: 450,
      type: "exception",
      reason: "Specialist consult required",
      status: "pending",
      category: "bills",
    } as any;

    render(
      <ApprovalsTab
        agentConnected
        approvals={[exceptionTx]}
        loading={false}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/Request exception/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Approve exception/i }));
    expect(onApprove).toHaveBeenCalledWith("exception-1");
  });
});
