/**
 * Tests for the shift handoff notes tab (Issue #1180).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HandoffNotesTab } from "../components/tabs/handoff-notes-tab";

const { caregiverFetchMock } = vi.hoisted(() => ({ caregiverFetchMock: vi.fn() }));
vi.mock("../lib/caregiver-fetch", () => ({ caregiverFetch: caregiverFetchMock }));

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const NOTE = {
  id: "note_1",
  recipient_id: "rosa_garcia",
  author: "David Garcia",
  text: "Gave the 2pm dose late, watch for nausea.",
  created_at: "2026-03-01T14:30:00.000Z",
};

describe("HandoffNotesTab (#1180)", () => {
  beforeEach(() => {
    caregiverFetchMock.mockReset();
  });

  it("loads the recipient's notes", async () => {
    caregiverFetchMock.mockResolvedValue(json({ notes: [NOTE] }));
    render(<HandoffNotesTab recipientId="rosa_garcia" authorName="Maria Garcia" />);

    expect(await screen.findByText(NOTE.text)).toBeTruthy();
    expect(screen.getByText("David Garcia")).toBeTruthy();
    expect(caregiverFetchMock).toHaveBeenCalledWith("/recipients/rosa_garcia/handoff-notes?limit=20");
  });

  it("shows the empty state", async () => {
    caregiverFetchMock.mockResolvedValue(json({ notes: [] }));
    render(<HandoffNotesTab recipientId="rosa_garcia" authorName="Maria Garcia" />);
    expect(await screen.findByText(/No handoff notes yet/i)).toBeTruthy();
  });

  it("posts a note and prepends it to the feed", async () => {
    caregiverFetchMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json({ ...NOTE, id: "note_2", author: "Maria Garcia", text: "Slept well." }, 201)
        : json({ notes: [NOTE] }),
    );
    render(<HandoffNotesTab recipientId="rosa_garcia" authorName="Maria Garcia" />);
    await screen.findByText(NOTE.text);

    fireEvent.change(screen.getByLabelText(/New note/i), { target: { value: "Slept well." } });
    fireEvent.click(screen.getByRole("button", { name: /Post note/i }));

    expect(await screen.findByText("Slept well.")).toBeTruthy();
    const post = caregiverFetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post![1].body))).toEqual({ text: "Slept well.", author: "Maria Garcia" });
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Slept well.");
  });

  it("explains when the caller's role cannot post", async () => {
    caregiverFetchMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ error: "forbidden" }, 403) : json({ notes: [] }),
    );
    render(<HandoffNotesTab recipientId="rosa_garcia" authorName="Maria Garcia" />);
    await screen.findByText(/No handoff notes yet/i);

    fireEvent.change(screen.getByLabelText(/New note/i), { target: { value: "Hi" } });
    fireEvent.click(screen.getByRole("button", { name: /Post note/i }));

    expect(await screen.findByText(/can read notes but not post them/i)).toBeTruthy();
  });

  it("does not post an empty note", async () => {
    caregiverFetchMock.mockResolvedValue(json({ notes: [] }));
    render(<HandoffNotesTab recipientId="rosa_garcia" authorName="Maria Garcia" />);
    fireEvent.click(screen.getByRole("button", { name: /Post note/i }));

    expect(await screen.findByText(/Write a note before posting/i)).toBeTruthy();
    await waitFor(() => expect(caregiverFetchMock).toHaveBeenCalledTimes(1));
  });
});
