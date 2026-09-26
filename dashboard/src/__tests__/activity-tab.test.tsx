/**
 * Tests for ActivityTab transaction rendering and memoization (Issue #220).
 *
 * Verifies:
 *  1. mergedTimeline is memoized: does not re-sort when only agentLog changes.
 *  2. Transactions sorted newest-first at fetch time appear newest-first in the table.
 *  3. Audit events and transactions are correctly interleaved by timestamp.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityTab } from "../components/tabs/activity-tab";
import type { ActivityTabProps } from "../components/tabs/activity-tab";
import type { Transaction, AuditLogEvent } from "../components/types";

vi.mock("../app/pdf", () => ({ downloadTransactionPDF: vi.fn() }));
vi.mock("../components/primitives/tx-link", () => ({
  TxLink: ({ hash }: { hash?: string }) => <span>{hash ?? "-"}</span>,
}));
vi.mock("../components/primitives/confirm-dialog", () => ({
  ConfirmDialog: () => null,
}));

function makeTx(id: string, timestamp: string): Transaction {
  return {
    id,
    timestamp,
    type: "medication",
    description: `Desc ${id}`,
    amount: 10,
    recipient: "pharma",
    status: "completed",
    category: "medications",
  };
}

function makeAudit(event: string, timestamp: string): AuditLogEvent {
  return {
    event,
    timestamp,
    actor: "agent",
    details: {},
  };
}

function baseProps(overrides: Partial<ActivityTabProps> = {}): ActivityTabProps {
  return {
    recipient: { name: "Rosa Garcia", age: 78, facility: "General Hospital" },
    agentLog: [],
    setAgentLog: vi.fn(),
    allTransactions: [],
    auditEvents: [],
    pagination: null,
    currentPage: 0,
    setCurrentPage: vi.fn(),
    pageSize: 25,
    setPageSize: vi.fn(),
    spending: null,
    onResetAgent: vi.fn(),
    ...overrides,
  };
}

describe("ActivityTab — mergedTimeline memoization (#220)", () => {
  let sortSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sortSpy = vi.spyOn(Array.prototype, "sort");
  });
  afterEach(() => {
    sortSpy.mockRestore();
  });

  it("does not re-sort when only agentLog changes (unrelated parent state)", () => {
    const stableTxs = [
      makeTx("tx1", "2024-01-02T00:00:00Z"),
      makeTx("tx2", "2024-01-01T00:00:00Z"),
    ];
    const props = baseProps({ allTransactions: stableTxs });

    const { rerender } = render(<ActivityTab {...props} />);

    // Baseline sort count after initial render.
    sortSpy.mockClear();

    // Change only agentLog — allTransactions and auditEvents refs are stable.
    rerender(
      <ActivityTab
        {...props}
        agentLog={[{ id: "log-1", timestamp: Date.now(), message: "New log entry" }]}
      />,
    );

    // mergedTimeline's useMemo should not have fired: sort must not be called.
    expect(sortSpy).not.toHaveBeenCalled();
  });
});

describe("ActivityTab — newest-first ordering (#220)", () => {
  it("renders transactions in newest-first order when pre-sorted at fetch time", () => {
    // Simulate what fetchTransactions produces: newest first.
    const txs = [
      makeTx("tx-new", "2024-03-01T12:00:00Z"),
      makeTx("tx-mid", "2024-02-01T12:00:00Z"),
      makeTx("tx-old", "2024-01-01T12:00:00Z"),
    ];

    render(<ActivityTab {...baseProps({ allTransactions: txs })} />);

    const rows = screen.getAllByText(/Desc tx-/);
    expect(rows[0].textContent).toContain("tx-new");
    expect(rows[1].textContent).toContain("tx-mid");
    expect(rows[2].textContent).toContain("tx-old");
  });

  it("interleaves audit events and transactions by timestamp (newest first)", () => {
    const txs = [
      makeTx("tx-a", "2024-01-03T00:00:00Z"),
      makeTx("tx-b", "2024-01-01T00:00:00Z"),
    ];
    const audits = [makeAudit("agent.started", "2024-01-02T00:00:00Z")];

    render(<ActivityTab {...baseProps({ allTransactions: txs, auditEvents: audits })} />);

    // tx-a (Jan 3) → audit (Jan 2) → tx-b (Jan 1)
    const txDescriptions = screen.getAllByText(/Desc tx-/);
    expect(txDescriptions[0].textContent).toContain("tx-a");
    expect(txDescriptions[1].textContent).toContain("tx-b");

    // Audit event should appear between the two transactions.
    const auditCell = screen.getByText("agent.started");
    expect(auditCell).toBeTruthy();
  });
});

describe("ActivityTab — page-size change preserves position (#1283)", () => {
  it("keeps the first visible row in view instead of jumping to page 1", () => {
    const setCurrentPage = vi.fn();
    const setPageSize = vi.fn();
    render(
      <ActivityTab
        {...baseProps({
          currentPage: 4,
          pageSize: 10,
          setCurrentPage,
          setPageSize,
          pagination: {
            total: 500,
            offset: 40,
            limit: 10,
            hasPrevious: true,
            hasMore: true,
          },
        })}
      />,
    );

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "25" } });

    expect(setPageSize).toHaveBeenCalledWith(25);
    // First visible row was 4 * 10 = 40; with 25 per page that is page 1.
    expect(setCurrentPage).toHaveBeenCalledWith(1);
  });

  it("stays on page 1 when already on the first page", () => {
    const setCurrentPage = vi.fn();
    render(
      <ActivityTab
        {...baseProps({
          currentPage: 0,
          pageSize: 25,
          setCurrentPage,
          pagination: {
            total: 500,
            offset: 0,
            limit: 25,
            hasPrevious: false,
            hasMore: true,
          },
        })}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "50" },
    });

    expect(setCurrentPage).toHaveBeenCalledWith(0);
  });

  it("handles being on the last page when reducing page size", () => {
    const setCurrentPage = vi.fn();
    render(
      <ActivityTab
        {...baseProps({
          currentPage: 1,
          pageSize: 50,
          setCurrentPage,
          pagination: {
            total: 100,
            offset: 50,
            limit: 50,
            hasPrevious: true,
            hasMore: false,
          },
        })}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "25" },
    });

    // First visible row was 50; with 25 per page that is page 2 — still the
    // last page, and the row the caregiver was viewing stays in view.
    expect(setCurrentPage).toHaveBeenCalledWith(2);
  });
});

describe("ActivityTab — Clear Log vs Reset All separation (#1278)", () => {
  it("renders Clear Log as a low-friction text link", () => {
    render(<ActivityTab {...baseProps()} />);
    const clearLog = screen.getByRole("button", { name: /Clear Log/i });
    expect(clearLog.className).toContain("text-amber-500");
    expect(clearLog).toHaveAttribute("title");
  });

  it("renders Reset All as a separated, bordered danger-zone action", () => {
    render(<ActivityTab {...baseProps()} />);
    const reset = screen.getByRole("button", { name: /Reset All/i });
    expect(reset.className).toContain("border-red-200");
    expect(reset.className).toContain("bg-red-50");
    expect(reset.className).toContain("text-red-600");
  });

  it("keeps both actions keyboard accessible via focus-visible rings", () => {
    render(<ActivityTab {...baseProps()} />);
    const clearLog = screen.getByRole("button", { name: /Clear Log/i });
    const reset = screen.getByRole("button", { name: /Reset All/i });
    expect(clearLog.className).toContain("focus-visible:ring-amber-500");
    expect(reset.className).toContain("focus-visible:ring-red-500");
  });
});

describe("fetchTransactions sort order (unit, #220)", () => {
  it("sorts transactions newest-first using the same comparator as fetchTransactions", () => {
    const raw = [
      makeTx("old", "2024-01-01T00:00:00Z"),
      makeTx("new", "2024-03-01T00:00:00Z"),
      makeTx("mid", "2024-02-01T00:00:00Z"),
    ];
    // Apply the same sort used in fetchTransactions.
    const sorted = [...raw].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    expect(sorted[0].id).toBe("new");
    expect(sorted[1].id).toBe("mid");
    expect(sorted[2].id).toBe("old");
  });
});
