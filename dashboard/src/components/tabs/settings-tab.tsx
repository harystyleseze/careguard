"use client";

import { useState, useEffect } from "react";
import { copyText } from "../../lib/clipboard";
import type { RecipientProfile } from "../../lib/types";
import { Toast } from "../primitives/toast";
import type { AgentInfo } from "../types";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

interface MetricsSummary {
  summary: { totalToolCalls: number; totalCostUsdc: number };
}

export interface SettingsTabProps {
  recipient: RecipientProfile;
  agentInfo: AgentInfo | null;
  agentPaused: boolean;
  onTogglePause: () => void;
}

export function SettingsTab({
  recipient,
  agentInfo,
  agentPaused,
  onTogglePause,
}: SettingsTabProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastFallback, setToastFallback] = useState<string | undefined>(undefined);
  const [metricsSummary, setMetricsSummary] = useState<MetricsSummary | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    fetch(`${AGENT_URL}/agent/metrics/summary?since=${encodeURIComponent(since)}`)
      .then((r) => r.json())
      .then((data) => setMetricsSummary(data))
      .catch(() => {});
  }, []);

  const handleCopy = async (text: string, id: string) => {
    const result = await copyText(text);
    if (result === "ok" || result === "fallback") {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
      return;
    }
    setToastMsg("Couldn't copy. Press Ctrl+C.");
    setToastFallback(text);
  };

  return (
    <div
      role="tabpanel"
      id="tabpanel-settings"
      aria-labelledby="tab-settings"
      tabIndex={0}
      className="space-y-6 max-w-2xl"
    >
      <Toast
        message={toastMsg}
        fallbackText={toastFallback}
        onDismiss={() => {
          setToastMsg(null);
          setToastFallback(undefined);
        }}
      />
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Care Recipient
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Name
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {recipient.name}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Age
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {recipient.age ?? "N/A"}
            </div>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Medications
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Lisinopril, Metformin, Atorvastatin, Amlodipine
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Primary Doctor
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Dr. Chen, {recipient.facility || "General Hospital"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Insurance
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Medicare Part D
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Caregiver</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Name
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Maria Garcia
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Relationship
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Daughter
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Location
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Phoenix, AZ (800 miles from Rosa)
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Notifications
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              Email + SMS
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Agent Configuration
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Agent Status
            </label>
            <div className="flex items-center gap-2">
              <div
                className={`px-3 py-2 flex-1 bg-slate-50 border border-slate-200 rounded-lg text-sm ${agentPaused ? "text-amber-600" : "text-green-600"}`}
              >
                {agentPaused ? "Paused" : "Active"}
              </div>
              <button
                onClick={onTogglePause}
                className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all ${agentPaused ? "bg-green-500 text-white hover:bg-green-600" : "bg-amber-500 text-white hover:bg-amber-600"}`}
              >
                {agentPaused ? "Resume Agent" : "Pause Agent"}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              LLM Provider
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono">
              {agentInfo?.llm || "Not connected"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Network
            </label>
            <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm">
              {agentInfo?.network || "stellar:testnet"}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Agent Wallet
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono break-all">
                {agentInfo?.agentWallet || "Not connected"}
              </code>
              {agentInfo?.agentWallet && (
                <button
                  onClick={() =>
                    handleCopy(agentInfo.agentWallet, "settings-wallet")
                  }
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${copiedId === "settings-wallet" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {copiedId === "settings-wallet" ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Cost Summary</h2>
        {metricsSummary ? (
          <p className="text-sm text-slate-700">
            Last 7 days:{" "}
            <strong>{metricsSummary.summary.totalToolCalls}</strong> tool calls,{" "}
            <strong className="text-sky-600">
              ${metricsSummary.summary.totalCostUsdc.toFixed(4)}
            </strong>{" "}
            USDC spent on x402
          </p>
        ) : (
          <p className="text-sm text-slate-400">Connecting to agent…</p>
        )}
      </div>
    </div>
  );
}
