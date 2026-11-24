"use client";

import { useEffect, useState } from "react";
import { agentFetch } from "../lib/agent-fetch";
import { InteractionCheckSchema, type InteractionCheck } from "../lib/types";

export interface InteractionHistorySectionProps {
  recipientId?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  contraindicated: "bg-red-100 text-red-800",
  severe: "bg-red-100 text-red-800",
  major: "bg-orange-100 text-orange-800",
  moderate: "bg-amber-100 text-amber-800",
  minor: "bg-slate-100 text-slate-700",
};

/**
 * Past drug interaction checks for a recipient (#1193), filterable by drug,
 * so a caregiver can answer "have we checked X with Y before?".
 */
export function InteractionHistorySection({ recipientId = "rosa" }: InteractionHistorySectionProps) {
  const [checks, setChecks] = useState<InteractionCheck[]>([]);
  const [drug, setDrug] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounce the filter so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setFilter(drug.trim()), 300);
    return () => clearTimeout(timer);
  }, [drug]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ recipient_id: recipientId });
    if (filter) params.set("drug", filter);
    setLoading(true);
    agentFetch(`/agent/interaction-checks?${params.toString()}`)
      .then(async (res) => {
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        const parsed = InteractionCheckSchema.array().safeParse(body?.checks);
        setChecks(parsed.success ? parsed.data : []);
      })
      .catch(() => {
        if (!cancelled) setChecks([]); // offline agent: show the empty state
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipientId, filter]);

  return (
    <section aria-labelledby="interaction-history-heading" className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h2 id="interaction-history-heading" className="text-sm font-semibold text-slate-700">
            Interaction Check History
          </h2>
          <p className="text-xs text-slate-500">Past drug interaction checks for this recipient.</p>
        </div>
        <label className="text-xs text-slate-600">
          <span className="sr-only">Filter by drug name</span>
          <input
            type="search"
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            placeholder="Filter by drug…"
            aria-label="Filter by drug name"
            className="w-full sm:w-56 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading history…</p>
      ) : checks.length === 0 ? (
        <p className="text-sm text-slate-500">
          {filter ? `No past checks include "${filter}".` : "No interaction checks recorded yet."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Interaction checks">
          {checks.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-800">{c.medications.join(" + ")}</span>
                <time dateTime={c.checked_at} className="text-xs text-slate-500">
                  {new Date(c.checked_at).toLocaleString()}
                </time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {c.interaction_count === 0 ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">No interactions</span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 ${SEVERITY_STYLES[c.highest_severity ?? ""] ?? "bg-slate-100 text-slate-700"}`}
                  >
                    {c.interaction_count} interaction{c.interaction_count === 1 ? "" : "s"}
                    {c.highest_severity ? ` · highest: ${c.highest_severity}` : ""}
                  </span>
                )}
                {c.summary && <span className="text-slate-500">{c.summary}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
