/**
 * Pending sensitive profile changes in the approvals tab (#1233).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ProfileChangeApprovals } from "../components/profile-change-approvals";

const pending = {
  id: "pcr_1",
  recipient_id: "rosa",
  kind: "policy_limit_increase",
  summary: "Raise daily limit from $100.00 to $200.00",
  changes: [{ field: "dailyLimit", label: "Daily limit", before: 100, after: 200 }],
  status: "pending",
  requested_by: "david-garcia",
  requested_at: "2026-10-19T12:00:00Z",
};

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(JSON.stringify({ requests: [pending] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("ProfileChangeApprovals (#1233)", () => {
  it("lists the change with before/after values and lets an owner approve it", async () => {
    const fetchMock = mockFetch();
    render(<ProfileChangeApprovals agentConnected caregiverId="maria-garcia" isOwner />);
    expect(await screen.findByText("Raise daily limit from $100.00 to $200.00")).toBeTruthy();
    expect(screen.getByText("Daily limit: $100.00 → $200.00")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByText(/Raise daily limit/)).toBeNull());
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toContain("/agent/profile-changes/pcr_1/approve");
    expect(JSON.parse(String(init?.body))).toEqual({ caregiver_id: "maria-garcia" });
  });

  it("disables the decision for non-owners and says why", async () => {
    mockFetch();
    render(<ProfileChangeApprovals agentConnected caregiverId="david-garcia" isOwner={false} />);
    await screen.findByText(/Raise daily limit/);
    expect(screen.getByText(/Only a caregiver with the owner role/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
