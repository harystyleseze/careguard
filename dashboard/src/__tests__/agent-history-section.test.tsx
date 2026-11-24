/**
 * Tests for the searchable agent tool invocation history.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentHistorySection } from "../components/agent-history-section";

const { agentFetchMock } = vi.hoisted(() => ({ agentFetchMock: vi.fn() }));
vi.mock("../lib/agent-fetch", () => ({ agentFetch: agentFetchMock }));

function json(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

const TX_HASH = "a".repeat(64);

function entry(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `h${i}`,
    recipient_id: "rosa",
    run_id: `run-${i}`,
    task: "Pay [PATIENT NAME]'s bill",
    tool: "pay_bill",
    input: { amount: 120, memo: "[REDACTED]" },
    status: "success",
    summary: `Paid $120.00 — ER visit ${i}`,
    error: null,
    links: [],
    created_at: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

const ENTRIES = [
  entry(1, {
    links: [{ kind: "transaction", id: "tx-1", label: "ER visit · $120.00", stellarTxHash: TX_HASH }],
  }),
  entry(2, {
    tool: "generate_dispute_letter",
    summary: "Generated dispute letter ($45.50 overcharge)",
    links: [{ kind: "dispute", id: "dispute_1", label: "Dispute letter for bill b-9" }],
  }),
];

function page(entries: unknown[], total = entries.length, offset = 0, limit = 20) {
  return {
    entries,
    pagination: { total, limit, offset, hasMore: offset + limit < total, hasPrevious: offset > 0 },
  };
}

describe("AgentHistorySection", () => {
  beforeEach(() => {
    agentFetchMock.mockReset();
    agentFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/agent/history/tools")) return json({ tools: ["generate_dispute_letter", "pay_bill"] });
      const params = new URL(url, "http://x").searchParams;
      const tool = params.get("tool");
      return json(page(tool ? ENTRIES.filter((e) => e.tool.includes(tool)) : ENTRIES));
    });
  });

  it("lists invocations with redacted task, outcome and link-through", async () => {
    render(<AgentHistorySection />);
    expect(await screen.findByText("Paid $120.00 — ER visit 1")).toBeTruthy();
    expect(screen.getAllByText(/Pay \[PATIENT NAME\]'s bill/)).toHaveLength(2);

    const txLink = screen.getByText("ER visit · $120.00 →").closest("a")!;
    expect(txLink.getAttribute("href")).toContain(`/tx/${TX_HASH}`);
    expect(txLink.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("Dispute letter for bill b-9 →").closest("a")!.getAttribute("href")).toBe("?tab=bills");
    expect(agentFetchMock).toHaveBeenCalledWith("/agent/history?recipient_id=rosa&limit=20&offset=0");
  });

  it("filters by tool name and date", async () => {
    render(<AgentHistorySection />);
    await screen.findByText("Paid $120.00 — ER visit 1");
    await screen.findByRole("option", { name: "generate_dispute_letter" });

    fireEvent.change(screen.getByLabelText("Filter by tool"), { target: { value: "generate_dispute_letter" } });
    await waitFor(() => expect(screen.queryByText("Paid $120.00 — ER visit 1")).toBeNull());
    expect(screen.getByText("Generated dispute letter ($45.50 overcharge)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-10-01" } });
    await waitFor(() =>
      expect(agentFetchMock).toHaveBeenLastCalledWith(
        "/agent/history?recipient_id=rosa&limit=20&offset=0&tool=generate_dispute_letter&from=2026-10-01",
      ),
    );
  });

  it("paginates long histories", async () => {
    agentFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/agent/history/tools")) return json({ tools: [] });
      const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
      return json(page([entry(offset + 1)], 45, offset));
    });
    render(<AgentHistorySection />);
    expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
    expect((screen.getByText("Previous") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Next"));
    expect(await screen.findByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByText("Paid $120.00 — ER visit 21")).toBeTruthy();
  });

  it("shows an empty state when nothing is recorded", async () => {
    agentFetchMock.mockResolvedValue(json({ entries: [], tools: [] }));
    render(<AgentHistorySection />);
    expect(await screen.findByText("No agent activity recorded yet.")).toBeTruthy();
  });
});
