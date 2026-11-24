import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksTab, isOverdue, type CareTask } from "../components/tabs/tasks-tab";

const task = (o: Partial<CareTask>): CareTask => ({
  id: "t",
  recipient_id: "rosa_garcia",
  title: "Task",
  assignee: null,
  due_date: null,
  done: false,
  completed_at: null,
  created_at: "2026-10-01T00:00:00.000Z",
  ...o,
});

afterEach(() => vi.unstubAllGlobals());

describe("isOverdue (Issue #1200)", () => {
  it("is true only for open tasks due before today", () => {
    expect(isOverdue(task({ due_date: "2026-10-16" }), "2026-10-17")).toBe(true);
    expect(isOverdue(task({ due_date: "2026-10-17" }), "2026-10-17")).toBe(false);
    expect(isOverdue(task({ due_date: null }), "2026-10-17")).toBe(false);
    expect(isOverdue(task({ due_date: "2026-10-01", done: true }), "2026-10-17")).toBe(false);
  });
});

describe("TasksTab (Issue #1200)", () => {
  it("highlights overdue tasks, shows assignees and keeps completed ones in history", async () => {
    const tasks = [
      task({ id: "a", title: "Schedule follow-up", due_date: "2026-10-10", assignee: "David Garcia" }),
      task({ id: "b", title: "Arrange transport", due_date: "2026-10-30" }),
      task({ id: "c", title: "Call insurance", done: true, completed_at: "2026-10-12T10:00:00.000Z" }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => tasks })));

    render(<TasksTab recipientId="rosa_garcia" today={() => "2026-10-17"} />);

    const rows = await screen.findAllByTestId("task-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-overdue")).toBe("true");
    expect(rows[1].getAttribute("data-overdue")).toBeNull();
    expect(screen.getByText("Overdue · 2026-10-10")).toBeTruthy();
    expect(screen.getByText("David Garcia")).toBeTruthy();

    // Linked caregivers are offered as assignees.
    expect(screen.getByRole("option", { name: "Maria Garcia" })).toBeTruthy();

    // Completed tasks live in the history view.
    expect(screen.queryByText("Call insurance")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show completed \(1\)/ }));
    expect(screen.getByText("Call insurance")).toBeTruthy();
  });

  it("marks a task done via PATCH", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method ? {} : [task({ id: "a", title: "Call insurance" })]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TasksTab recipientId="rosa_garcia" today={() => "2026-10-17"} />);
    fireEvent.click(await screen.findByLabelText('Mark "Call insurance" done'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/recipients\/rosa_garcia\/tasks\/a$/),
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ done: true }) }),
      ),
    );
  });
});
