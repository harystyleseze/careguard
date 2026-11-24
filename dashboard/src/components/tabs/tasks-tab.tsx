"use client";

import { useCallback, useEffect, useState } from "react";
import type { CaregiverProfile } from "../../lib/types";
import { AGENT_URL } from "../../lib/agent-url";
import { type Locale } from "../../i18n";

/**
 * Shared caregiver checklist for non-payment care tasks (Issue #1200):
 * schedule a follow-up, call insurance, arrange transport. Tasks belong to the
 * selected care recipient, can be assigned to a linked caregiver, are
 * highlighted when overdue, and stay in a history list once completed.
 */

export interface CareTask {
  id: string;
  recipient_id: string;
  title: string;
  assignee: string | null;
  due_date: string | null; // YYYY-MM-DD
  done: boolean;
  completed_at: string | null;
  created_at: string;
}

export interface TasksTabProps {
  recipientId: string;
  linkedCaregivers?: CaregiverProfile[];
  locale?: Locale;
  /** Injectable for tests; defaults to the real clock. */
  today?: () => string;
}

/** Local calendar date as YYYY-MM-DD. */
export function localToday(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** An open task is overdue once its due date is before today. */
export function isOverdue(task: Pick<CareTask, "done" | "due_date">, today: string): boolean {
  return !task.done && !!task.due_date && task.due_date < today;
}

function authHeaders(): HeadersInit {
  const token =
    typeof document !== "undefined"
      ? document.cookie.split(";").find((c) => c.trim().startsWith("caregiver_token="))?.split("=")[1]
      : undefined;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const DEFAULT_CAREGIVERS: CaregiverProfile[] = [
  { name: "Maria Garcia", relationship: "Primary Caregiver" },
  { name: "David Garcia", relationship: "Secondary Caregiver" },
];

export function TasksTab({
  recipientId,
  linkedCaregivers = DEFAULT_CAREGIVERS,
  today = () => localToday(),
}: TasksTabProps) {
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const base = `${AGENT_URL}/recipients/${encodeURIComponent(recipientId)}/tasks`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Tasks returned ${res.status}`);
      setTasks(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await fetch(base, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title, assignee: assignee || null, due_date: dueDate || null }),
    });
    if (!res.ok) {
      setError(`Could not add task (${res.status})`);
      return;
    }
    setTitle("");
    setAssignee("");
    setDueDate("");
    await load();
  }

  async function setDone(task: CareTask, done: boolean) {
    const res = await fetch(`${base}/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    if (!res.ok) {
      setError(`Could not update task (${res.status})`);
      return;
    }
    await load();
  }

  const now = today();
  const open = tasks.filter((t) => !t.done);
  const completed = tasks.filter((t) => t.done);

  return (
    <section id="tabpanel-tasks" role="tabpanel" aria-labelledby="tab-tasks" className="space-y-6">
      <form onSubmit={addTask} className="bg-white rounded-lg border border-slate-200 p-4 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-sm flex-1 min-w-[12rem]">
          Task
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Call insurance about the denied claim"
            maxLength={200}
            required
            className="mt-1 rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col text-sm">
          Assign to
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2"
          >
            <option value="">Unassigned</option>
            {linkedCaregivers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          Due
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600">
          Add task
        </button>
      </form>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="bg-white rounded-lg border border-slate-200">
        <h2 className="px-4 pt-4 text-sm font-semibold text-slate-700">Open tasks ({open.length})</h2>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : open.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No open tasks.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {open.map((task) => {
              const overdue = isOverdue(task, now);
              return (
                <li
                  key={task.id}
                  data-testid="task-row"
                  data-overdue={overdue || undefined}
                  className={`flex items-center gap-3 px-4 py-3 ${overdue ? "bg-red-50" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Mark "${task.title}" done`}
                    checked={false}
                    onChange={() => void setDone(task, true)}
                  />
                  <span className="flex-1 text-sm text-slate-800">{task.title}</span>
                  <span className="text-xs text-slate-500">{task.assignee ?? "Unassigned"}</span>
                  {task.due_date && (
                    <span className={`text-xs ${overdue ? "font-semibold text-red-600" : "text-slate-500"}`}>
                      {overdue ? `Overdue · ${task.due_date}` : `Due ${task.due_date}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-700"
        >
          {showHistory ? "Hide" : "Show"} completed ({completed.length})
        </button>
        {showHistory && (
          <ul className="divide-y divide-slate-100" aria-label="Completed tasks">
            {completed.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={`Reopen "${task.title}"`}
                  checked
                  onChange={() => void setDone(task, false)}
                />
                <span className="flex-1 text-sm text-slate-500 line-through">{task.title}</span>
                <span className="text-xs text-slate-400">{task.assignee ?? "Unassigned"}</span>
                {task.completed_at && (
                  <span className="text-xs text-slate-400">Done {task.completed_at.slice(0, 10)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
