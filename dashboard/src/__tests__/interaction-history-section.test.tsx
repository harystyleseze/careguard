/**
 * Tests for the interaction check history view (Issue #1193).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InteractionHistorySection } from "../components/interaction-history-section";

const { agentFetchMock } = vi.hoisted(() => ({ agentFetchMock: vi.fn() }));
vi.mock("../lib/agent-fetch", () => ({ agentFetch: agentFetchMock }));

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const CHECKS = [
  {
    id: "c1",
    recipient_id: "rosa",
    medications: ["Warfarin", "Aspirin"],
    interaction_count: 1,
    highest_severity: "major",
    summary: "Bleeding risk",
    interactions: [{}],
    checked_at: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "c2",
    recipient_id: "rosa",
    medications: ["Lisinopril", "Metformin"],
    interaction_count: 0,
    highest_severity: null,
    summary: null,
    interactions: [],
    checked_at: "2026-09-01T10:00:00.000Z",
  },
];

describe("InteractionHistorySection (#1193)", () => {
  beforeEach(() => {
    agentFetchMock.mockReset();
    agentFetchMock.mockImplementation(async (url: string) => {
      const drug = new URL(url, "http://x").searchParams.get("drug")?.toLowerCase();
      const checks = drug ? CHECKS.filter((c) => c.medications.some((m) => m.toLowerCase().includes(drug))) : CHECKS;
      return json({ checks });
    });
  });

  it("lists past checks with drugs, result and severity", async () => {
    render(<InteractionHistorySection />);
    expect(await screen.findByText("Warfarin + Aspirin")).toBeTruthy();
    expect(screen.getByText("Lisinopril + Metformin")).toBeTruthy();
    expect(screen.getByText(/1 interaction · highest: major/)).toBeTruthy();
    expect(screen.getByText("No interactions")).toBeTruthy();
    expect(agentFetchMock).toHaveBeenCalledWith("/agent/interaction-checks?recipient_id=rosa");
  });

  it("filters history by drug name", async () => {
    render(<InteractionHistorySection />);
    await screen.findByText("Warfarin + Aspirin");
    fireEvent.change(screen.getByLabelText("Filter by drug name"), { target: { value: "metformin" } });
    await waitFor(() => expect(screen.queryByText("Warfarin + Aspirin")).toBeNull(), { timeout: 2000 });
    expect(screen.getByText("Lisinopril + Metformin")).toBeTruthy();
    expect(agentFetchMock).toHaveBeenLastCalledWith("/agent/interaction-checks?recipient_id=rosa&drug=metformin");
  });

  it("shows an empty state when nothing matches", async () => {
    agentFetchMock.mockResolvedValue(json({ checks: [] }));
    render(<InteractionHistorySection />);
    expect(await screen.findByText("No interaction checks recorded yet.")).toBeTruthy();
  });
});
