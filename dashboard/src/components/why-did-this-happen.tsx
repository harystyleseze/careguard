"use client";

import { useEffect, useMemo, useState } from "react";
import { agentFetch } from "../lib/agent-fetch";

/** Mirrors ActionReasoning in shared/action-reasoning.ts (already redacted server-side). */
export interface ActionReasoning {
  id: string;
  createdAt: string;
  kind: string;
  title: string;
  outcome: string;
  steps: Array<{ tool: string; summary: string }>;
  dataPoints: Array<{ label: string; value: string }>;
  transactionId?: string;
  toolCallId?: string;
}

/** How many recent traces the views load; the agent keeps the last 500. */
const REASONING_FETCH_LIMIT = 200;

/**
 * Loads recent reasoning traces (#1235), indexed by transaction id and tool
 * call id. `refreshKey` should change whenever new actions may have happened.
 */
export function useActionReasoning(refreshKey: unknown) {
  const [entries, setEntries] = useState<ActionReasoning[]>([]);

  useEffect(() => {
    let cancelled = false;
    agentFetch(`/agent/reasoning?limit=${REASONING_FETCH_LIMIT}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.reasoning)) setEntries(data.reasoning);
      })
      .catch(() => {
        // Explanations are optional context; the views work without them.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return useMemo(() => {
    const byTransaction = new Map<string, ActionReasoning>();
    const byToolCall = new Map<string, ActionReasoning>();
    // Entries arrive newest first; keep the newest trace per key.
    for (const entry of entries) {
      if (entry.transactionId && !byTransaction.has(entry.transactionId)) byTransaction.set(entry.transactionId, entry);
      if (entry.toolCallId && !byToolCall.has(entry.toolCallId)) byToolCall.set(entry.toolCallId, entry);
    }
    return { byTransaction, byToolCall };
  }, [entries]);
}

/** Expandable plain-language trace of why the agent took an action. */
export function WhyDidThisHappen({ reasoning }: { reasoning: ActionReasoning }) {
  return (
    <details className="mt-1 group" data-testid="why-did-this-happen">
      <summary className="list-none cursor-pointer text-[11px] font-medium text-sky-700 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 rounded inline-flex items-center gap-1">
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ▸
        </span>
        Why did this happen?
      </summary>
      <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50/60 p-3 text-xs text-slate-700 space-y-2 max-w-xl">
        <div>
          <p className="font-semibold text-slate-800">{reasoning.title}</p>
          <p className="mt-0.5">{reasoning.outcome}</p>
        </div>
        {reasoning.steps.length > 0 && (
          <div>
            <p className="font-semibold text-slate-600">What the agent checked</p>
            <ol className="mt-1 list-decimal list-inside space-y-0.5">
              {reasoning.steps.map((step, i) => (
                <li key={`${step.tool}-${i}`}>{step.summary}</li>
              ))}
            </ol>
          </div>
        )}
        {reasoning.dataPoints.length > 0 && (
          <div>
            <p className="font-semibold text-slate-600">Key details</p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {reasoning.dataPoints.map((point, i) => (
                <div key={`${point.label}-${i}`} className="contents">
                  <dt className="text-slate-500">{point.label}</dt>
                  <dd className="text-slate-800">{point.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p className="text-[10px] text-slate-400">
          Recorded {new Date(reasoning.createdAt).toLocaleString()}. Names and medication doses are redacted.
        </p>
      </div>
    </details>
  );
}
