/**
 * Tests for manual vitals logging alongside adherence (Issue #1237).
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VitalsSection } from "../components/vitals-section";

const { agentFetchMock } = vi.hoisted(() => ({ agentFetchMock: vi.fn() }));
vi.mock("../lib/agent-fetch", () => ({ agentFetch: agentFetchMock }));

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const BP = {
  id: "v1",
  recipient_id: "rosa",
  type: "blood_pressure",
  value: 128,
  secondary_value: 82,
  unit: "mmHg",
  timestamp: "2026-03-01T08:00:00.000Z",
};

function route(vitals: unknown[], events: unknown[] = []) {
  agentFetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/agent/vitals") && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return json({ ...BP, id: "v-new", ...body, timestamp: "2026-03-03T08:00:00.000Z" });
    }
    if (url.startsWith("/agent/vitals")) return json({ vitals });
    if (url.startsWith("/agent/adherence/timeline")) return json({ events });
    return json({}, false);
  });
}

describe("VitalsSection (#1237)", () => {
  beforeEach(() => {
    agentFetchMock.mockReset();
  });

  it("shows the empty state when no readings exist", async () => {
    route([]);
    render(<VitalsSection />);
    expect(await screen.findByText(/No readings logged yet/i)).toBeTruthy();
  });

  it("charts readings with adherence markers and lists recent readings", async () => {
    route(
      [BP, { ...BP, id: "v2", value: 135, secondary_value: 88, timestamp: "2026-03-05T08:00:00.000Z" }],
      [
        { id: "a1", drug: "Lisinopril", date: "2026-03-02T08:00:00.000Z", status: "confirmed" },
        { id: "a2", drug: "Lisinopril", date: "2026-03-04T08:00:00.000Z", status: "skipped" },
        { id: "a3", drug: "Lisinopril", date: "2027-01-01T08:00:00.000Z", status: "pending" },
      ],
    );
    render(<VitalsSection />);
    const chart = await screen.findByRole("img", { name: /Blood pressure trend: 2 readings, 2 adherence events/i });
    expect(chart).toBeTruthy();
    expect(screen.getByText("128/82 mmHg")).toBeTruthy();
    expect(screen.getByText("135/88 mmHg")).toBeTruthy();
  });

  it("requires both blood pressure readings before logging", async () => {
    route([]);
    render(<VitalsSection />);
    await screen.findByText(/No readings logged yet/i);
    fireEvent.change(screen.getByLabelText(/Systolic/), { target: { value: "130" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Log reading/i }));
    });
    expect(screen.getByRole("alert").textContent).toMatch(/positive number/i);
    expect(agentFetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/agent/vitals"), expect.objectContaining({ method: "POST" }));
  });

  it("logs a glucose reading and reports vitals to the parent for export", async () => {
    route([]);
    const onVitalsChange = vi.fn();
    render(<VitalsSection onVitalsChange={onVitalsChange} />);
    await screen.findByText(/No readings logged yet/i);

    fireEvent.click(screen.getByRole("button", { name: "Glucose" }));
    fireEvent.change(screen.getByLabelText(/Glucose \(mg\/dL\)/), { target: { value: "110" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Log reading/i }));
    });

    expect(agentFetchMock).toHaveBeenCalledWith(
      "/agent/vitals?recipient_id=rosa",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "glucose", value: 110, unit: "mg/dL" }) }),
    );
    await waitFor(() => expect(screen.getByText("110 mg/dL")).toBeTruthy());
    expect(onVitalsChange).toHaveBeenLastCalledWith([expect.objectContaining({ type: "glucose", value: 110 })]);
  });
});
