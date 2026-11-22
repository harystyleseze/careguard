"use client";

import { useEffect, useId, useState } from "react";
import { agentFetch } from "../lib/agent-fetch";

interface NetworkEntry {
  id?: string;
  name: string;
}

interface InsuranceNetwork {
  plan: string | null;
  pharmacies: NetworkEntry[];
  providers: NetworkEntry[];
  updatedAt: string | null;
  updatedBy: string | null;
}

function toLines(entries: NetworkEntry[]): string {
  return entries.map((e) => e.name).join("\n");
}

/** One entry per line; keeps the id of an entry whose name is unchanged. */
function fromLines(text: string, previous: NetworkEntry[]): NetworkEntry[] {
  const byName = new Map(previous.map((e) => [e.name.trim().toLowerCase(), e]));
  const seen = new Set<string>();
  const entries: NetworkEntry[] = [];
  for (const line of text.split("\n")) {
    const name = line.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const prior = byName.get(key);
    entries.push(prior?.id ? { id: prior.id, name } : { name });
  }
  return entries;
}

/**
 * Manually maintained in-network pharmacy/provider lists (#1234). The agent
 * flags anything not on these lists as out-of-network during price
 * comparison and bill audits; leaving a list empty means "unknown".
 */
export function InsuranceNetworkEditor({
  recipientId = "rosa",
  caregiverName,
  defaultPlan,
}: {
  recipientId?: string;
  caregiverName?: string;
  defaultPlan?: string;
}) {
  const headingId = useId();
  const [network, setNetwork] = useState<InsuranceNetwork | null>(null);
  const [plan, setPlan] = useState("");
  const [pharmacies, setPharmacies] = useState("");
  const [providers, setProviders] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    agentFetch(`/agent/insurance-network?recipient_id=${encodeURIComponent(recipientId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { network: InsuranceNetwork }) => {
        if (cancelled) return;
        setNetwork(data.network);
        setPlan(data.network.plan ?? defaultPlan ?? "");
        setPharmacies(toLines(data.network.pharmacies));
        setProviders(toLines(data.network.providers));
        setStatus("idle");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [recipientId, defaultPlan]);

  async function save() {
    setStatus("saving");
    try {
      const res = await agentFetch(`/agent/insurance-network?recipient_id=${encodeURIComponent(recipientId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.trim() || null,
          pharmacies: fromLines(pharmacies, network?.pharmacies ?? []),
          providers: fromLines(providers, network?.providers ?? []),
          updated_by: caregiverName,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: { network: InsuranceNetwork } = await res.json();
      setNetwork(data.network);
      setPharmacies(toLines(data.network.pharmacies));
      setProviders(toLines(data.network.providers));
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  const fieldClass =
    "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-semibold text-slate-700">
        Insurance Network
      </h2>
      <p className="text-xs text-slate-500 mt-1 mb-4">
        List the pharmacies and providers that are in-network for this plan, one per line. The agent flags
        anything else as out-of-network when comparing prices or auditing bills, and explains the coverage
        risk. Leave a list empty if you don&apos;t know — nothing is flagged until a list exists.
      </p>
      <div className="space-y-3">
        <div>
          <label htmlFor={`${headingId}-plan`} className="block text-xs font-medium text-slate-600 mb-1">
            Plan name
          </label>
          <input id={`${headingId}-plan`} value={plan} onChange={(e) => setPlan(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label htmlFor={`${headingId}-pharmacies`} className="block text-xs font-medium text-slate-600 mb-1">
            In-network pharmacies
          </label>
          <textarea
            id={`${headingId}-pharmacies`}
            rows={4}
            value={pharmacies}
            onChange={(e) => setPharmacies(e.target.value)}
            placeholder={"CVS Pharmacy\nWalgreens"}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor={`${headingId}-providers`} className="block text-xs font-medium text-slate-600 mb-1">
            In-network providers
          </label>
          <textarea
            id={`${headingId}-providers`}
            rows={4}
            value={providers}
            onChange={(e) => setProviders(e.target.value)}
            placeholder={"General Hospital\nDr. Chen"}
            className={fieldClass}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500" aria-live="polite">
            {status === "loading" && "Loading…"}
            {status === "saved" && "Saved."}
            {status === "error" && "Couldn't reach the agent — try again."}
            {status === "idle" && network?.updatedAt && `Last updated ${new Date(network.updatedAt).toLocaleString()}`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={status === "saving" || status === "loading"}
            className="px-4 py-2 bg-sky-500 text-white rounded-lg text-xs font-medium hover:bg-sky-600 disabled:opacity-50 cursor-pointer"
          >
            {status === "saving" ? "Saving…" : "Save network"}
          </button>
        </div>
      </div>
    </section>
  );
}
