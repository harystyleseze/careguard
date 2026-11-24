/**
 * Tests for the linked caregivers section on the settings page (Issue #1179).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LinkedCaregiversSection } from "../components/linked-caregivers-section";

const { caregiverFetchMock } = vi.hoisted(() => ({ caregiverFetchMock: vi.fn() }));
vi.mock("../lib/caregiver-fetch", () => ({ caregiverFetch: caregiverFetchMock }));

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const OWNER = {
  caregiver_user_id: "maria@example.com",
  email: "maria@example.com",
  display_name: "Maria Garcia",
  role: "owner",
  status: "active",
  created_at: "2026-03-01T00:00:00.000Z",
};

describe("LinkedCaregiversSection (#1179)", () => {
  beforeEach(() => {
    caregiverFetchMock.mockReset();
  });

  it("lists every linked caregiver with their role", async () => {
    caregiverFetchMock.mockResolvedValue(
      json({
        caregivers: [
          OWNER,
          { ...OWNER, caregiver_user_id: "aide@example.com", email: "aide@example.com", display_name: null, role: "viewer", status: "invited" },
        ],
      }),
    );
    render(<LinkedCaregiversSection recipientId="rosa_garcia" />);

    expect(await screen.findByText("Maria Garcia")).toBeTruthy();
    expect(screen.getByText("aide@example.com")).toBeTruthy();
    expect(screen.getByText("Invite pending")).toBeTruthy();
    expect(caregiverFetchMock).toHaveBeenCalledWith("/recipients/rosa_garcia/caregivers");
  });

  it("invites a caregiver by email and shows the one-time invite code", async () => {
    caregiverFetchMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(
            {
              caregiver: { ...OWNER, caregiver_user_id: "david@example.com", email: "david@example.com", display_name: null, role: "co-caregiver", status: "invited" },
              inviteToken: "invite-code-123",
            },
            201,
          )
        : json({ caregivers: [OWNER] }),
    );
    render(<LinkedCaregiversSection recipientId="rosa_garcia" />);
    await screen.findByText("Maria Garcia");

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "david@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    expect(await screen.findByText("invite-code-123")).toBeTruthy();
    expect(screen.getAllByText("david@example.com").length).toBeGreaterThan(0);
    const post = caregiverFetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post![0]).toBe("/recipients/rosa_garcia/caregivers/invites");
    expect(JSON.parse(String(post![1].body))).toEqual({ email: "david@example.com", role: "co-caregiver" });
  });

  it("validates the email before inviting", async () => {
    caregiverFetchMock.mockResolvedValue(json({ caregivers: [] }));
    render(<LinkedCaregiversSection recipientId="rosa_garcia" />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    expect(await screen.findByText(/Enter a valid email address/i)).toBeTruthy();
    expect(caregiverFetchMock).toHaveBeenCalledTimes(1);
  });

  it("tells non-owners they cannot invite", async () => {
    caregiverFetchMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ error: "forbidden" }, 403) : json({ caregivers: [OWNER] }),
    );
    render(<LinkedCaregiversSection recipientId="rosa_garcia" />);
    await screen.findByText("Maria Garcia");

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "david@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Send invite/i }));

    expect(await screen.findByText(/Only owners can invite caregivers/i)).toBeTruthy();
  });
});
