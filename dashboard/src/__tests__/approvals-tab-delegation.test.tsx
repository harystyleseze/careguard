import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../lib/types";

const agentFetch = vi.fn();
vi.mock("../lib/agent-fetch", () => ({ agentFetch: (...args: unknown[]) => agentFetch(...args) }));

import { ApprovalsTab } from "../components/tabs/approvals-tab";

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

function respondWith(delegations: unknown[]) {
  agentFetch.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("/agent/delegations") ? { delegations } : {}),
  }));
}

afterEach(() => agentFetch.mockReset());

const DAVID = { name: "David Garcia", relationship: "Secondary Caregiver" };

describe("ApprovalsTab delegation (#1195)", () => {
  it("shows the delegation banner and approves on behalf of the delegator", async () => {
    respondWith([{ id: "dlg_1", delegator: "maria-garcia", ends_at: new Date(Date.now() + 3_600_000).toISOString() }]);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalsTab agentConnected approvals={[APPROVAL]} loading={false} onApprove={onApprove} onCancel={onCancel} currentCaregiver={DAVID} />);

    await waitFor(() => expect(screen.getByText(/Delegated approval:/)).toBeTruthy());
    expect(agentFetch).toHaveBeenCalledWith(expect.stringContaining("/agent/delegations?recipient_id=rosa&delegate=david-garcia"));

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const actor = { caregiverId: "david-garcia", onBehalfOf: "maria-garcia" };
    expect(onApprove).toHaveBeenCalledWith("approval-1", actor);
    expect(onCancel).toHaveBeenCalledWith("approval-1", actor);
  });

  it("shows no banner and acts as self when there is no active delegation", async () => {
    respondWith([]);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalsTab agentConnected approvals={[APPROVAL]} loading={false} onApprove={onApprove} onCancel={vi.fn()} currentCaregiver={DAVID} />);
    await waitFor(() => expect(agentFetch).toHaveBeenCalledWith(expect.stringContaining("/agent/delegations")));
    expect(screen.queryByText(/Delegated approval:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith("approval-1");
  });

  it("ignores a delegation whose end time has already passed", async () => {
    respondWith([{ id: "dlg_old", delegator: "maria-garcia", ends_at: new Date(Date.now() - 1000).toISOString() }]);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalsTab agentConnected approvals={[APPROVAL]} loading={false} onApprove={onApprove} onCancel={vi.fn()} currentCaregiver={DAVID} />);
    await waitFor(() => expect(agentFetch).toHaveBeenCalled());
    expect(screen.queryByText(/Delegated approval:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith("approval-1");
  });
});
