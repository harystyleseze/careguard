"use client";

import { useEffect, useState } from "react";
import { agentFetch } from "../lib/agent-fetch";
import { EXPLORER_TX_URL } from "../lib/stellar-network";
import {
  AgentHistoryEntrySchema,
  type AgentHistoryEntry,
  type AgentHistoryLink,
} from "../lib/types";

export interface AgentHistorySectionProps {
  recipientId?: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<AgentHistoryEntry["status"], string> = {
  success: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  blocked: "bg-red-100 text-red-800",
  error: "bg-red-100 text-red-800",
};

/** Dashboard tab each linked record lives in. */
const LINK_TABS: Record<AgentHistoryLink["kind"], string> = {
  transaction: "activity",
  approval: "approvals",
  dispute: "bills",
  bill_audit: "bills",
  interaction_check: "medications",
};

const STELLAR_TX_HASH_RE = /^[0-9a-f]{64}$/i;

function linkHref(link: AgentHistoryLink): string {
  if (link.kind === "transaction" && link.stellarTxHash && STELLAR_TX_HASH_RE.test(link.stellarTxHash)) {
    return `${EXPLORER_TX_URL}/${link.stellarTxHash}`;
  }
  return `?tab=${LINK_TABS[link.kind]}`;
}

/**
 * Searchable transcript of what the agent was asked to do and how each tool
 * call turned out, so a caregiver can recall why a payment or audit happened.
 * Inputs and task text arrive already redacted from /agent/history.
 */
export function AgentHistorySection({ recipientId = "rosa" }: AgentHistorySectionProps) {
  const [entries, setEntries] = useState<AgentHistoryEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [tools, setTools] = useState<string[]>([]);
  const [tool, setTool] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    agentFetch(`/agent/history/tools?recipient_id=${encodeURIComponent(recipientId)}`)
      .then(async (res) => {
        const body = res.ok ? await res.json() : null;
        if (!cancelled && Array.isArray(body?.tools)) setTools(body.tools.filter((t: unknown) => typeof t === "string"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recipientId]);

  // Any filter (or recipient) change starts back at the first page; done during
  // render rather than in an effect so the stale page is never fetched.
  const filterKey = `${recipientId}|${tool}|${from}|${to}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setOffset(0);
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      recipient_id: recipientId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (tool) params.set("tool", tool);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    setLoading(true);
    agentFetch(`/agent/history?${params.toString()}`)
      .then(async (res) => {
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;
        const parsed = AgentHistoryEntrySchema.array().safeParse(body?.entries);
        setEntries(parsed.success ? parsed.data : []);
        setPagination(parsed.success && body?.pagination ? body.pagination : null);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]); // offline agent: show the empty state
          setPagination(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipientId, tool, from, to, offset]);

  const filtered = Boolean(tool || from || to);
  const pageCount = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;
  const page = pagination ? Math.floor(pagination.offset / pagination.limit) + 1 : 1;

  return (
    <section aria-labelledby="agent-history-heading" className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-3">
        <div>
          <h2 id="agent-history-heading" className="text-sm font-semibold text-slate-700">
            Agent History
          </h2>
          <p className="text-xs text-slate-500">What the agent was asked to do and how each step turned out.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs text-slate-600">
          <label className="flex flex-col gap-1">
            Tool
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value)}
              aria-label="Filter by tool"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All tools</option>
              {tools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            From
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From date"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            To
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="To date"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          {filtered && (
            <button
              onClick={() => {
                setTool("");
                setFrom("");
                setTo("");
              }}
              className="px-2 py-1.5 text-xs text-sky-600 hover:text-sky-800 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading history…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">
          {filtered ? "No agent activity matches these filters." : "No agent activity recorded yet."}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Agent tool invocations">
          {entries.map((e) => (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium text-slate-800">{e.tool}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                </div>
                <time dateTime={e.created_at} className="text-xs text-slate-500">
                  {new Date(e.created_at).toLocaleString()}
                </time>
              </div>
              {e.task && <p className="mt-1 text-xs text-slate-500">Asked: “{e.task}”</p>}
              <p className="mt-1 text-sm text-slate-700">{e.summary}</p>
              {e.links.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {e.links.map((link, i) => {
                    const href = linkHref(link);
                    const external = href.startsWith("http");
                    return (
                      <a
                        key={`${link.kind}-${link.id ?? i}`}
                        href={href}
                        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className="text-sky-600 hover:text-sky-800 underline"
                      >
                        {link.label} →
                      </a>
                    );
                  })}
                </div>
              )}
              {Object.keys(e.input).length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">Parameters</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(e.input, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.total > pagination.limit && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-600">
          <span>{pagination.total} entries</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!pagination.hasPrevious}
              className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
            >
              Previous
            </button>
            <span className="px-2">
              Page {page} of {pageCount}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!pagination.hasMore}
              className="px-2 py-1 border border-slate-300 rounded bg-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
