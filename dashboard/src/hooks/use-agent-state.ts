"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SpendingDataSchema,
  TransactionSchema,
  type SpendingData,
  type Transaction,
} from "../lib/types";
import type {
  AgentInfo,
  AgentLogEntry,
  AgentResult,
  PaginationData,
  Tab,
} from "../components/types";

const AGENT_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

export type PolicyForm = typeof DEFAULT_POLICY;

export interface UseAgentStateOptions {
  activeTab: Tab;
}

export function useAgentState({ activeTab }: UseAgentStateOptions) {
  const [spending, setSpending] = useState<SpendingData | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTask, setActiveTask] = useState("");
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [walletXlm, setWalletXlm] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [policyForm, setPolicyForm] = useState<PolicyForm>(DEFAULT_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);

  const activeTabRef = useRef(activeTab);
  const policyDirtyRef = useRef(policyDirty);
  const lastConnectionStateRef = useRef<string | null>(null);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    policyDirtyRef.current = policyDirty;
  }, [policyDirty]);

  useEffect(() => {
    const connectionState = !agentConnected
      ? "disconnected"
      : agentPaused
        ? "paused"
        : "active";
    const prev = lastConnectionStateRef.current;
    if (prev === connectionState) return;
    lastConnectionStateRef.current = connectionState;
    if (connectionState === "active") setLiveMessage("Agent connected");
    if (connectionState === "paused") setLiveMessage("Agent paused");
    if (connectionState === "disconnected") setLiveMessage("Agent disconnected");
  }, [agentConnected, agentPaused]);

  const addLogEntry = useCallback((message: string) => {
    setAgentLog((prev) => {
      const entry: AgentLogEntry = {
        id: `${Date.now()}-${Math.random()}`,
        timestamp: Date.now(),
        message,
      };
      const next = [...prev, entry];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, []);

  const fetchAgentInfo = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/`);
      if (!res.ok) return;
      const data = await res.json();
      setAgentInfo(data);
      setAgentConnected(true);
      setAgentPaused(Boolean(data.paused));
      // Fetch wallet balance from server (Issue #134 - server-side cache)
      if (data.agentWallet) {
        try {
          const wres = await fetch(`${AGENT_URL}/agent/wallet`);
          if (wres.ok) {
            const wdata = await wres.json();
            setWalletBalance(wdata.usdc || "0.00");
            setWalletXlm(wdata.xlm || "0.00");
          }
        } catch {}
      }
    } catch {
      setAgentConnected(false);
    }
  }, []);

  const fetchSpending = useCallback(async (opts?: { forcePolicySync?: boolean }) => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/spending`);
      if (!res.ok) return;
      const data = SpendingDataSchema.parse(await res.json());
      setSpending(data);
      const forcePolicySync = Boolean(opts?.forcePolicySync);
      const shouldSyncPolicy =
        forcePolicySync ||
        (activeTabRef.current !== "policy" && !policyDirtyRef.current);
      if (shouldSyncPolicy) {
        setPolicyForm(data.policy);
        setPolicyDirty(false);
      }
    } catch {}
  }, []);

  const fetchTransactions = useCallback(async (limit?: number, offset?: number) => {
    try {
      const params = new URLSearchParams();
      if (limit) params.append("limit", limit.toString());
      if (offset) params.append("offset", offset.toString());
      const res = await fetch(`${AGENT_URL}/agent/transactions?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const txs = Array.isArray(data.transactions)
        ? data.transactions.map((t: unknown) => TransactionSchema.parse(t))
        : [];
      setAllTransactions(txs);
      if (data.pagination) setPagination(data.pagination);
    } catch {}
  }, []);

  useEffect(() => {
    fetchAgentInfo();
    fetchSpending();
    fetchTransactions(pageSize, currentPage * pageSize);
    const i = setInterval(() => {
      fetchSpending();
      fetchTransactions(pageSize, currentPage * pageSize);
    }, 3000);
    const j = setInterval(fetchAgentInfo, 10000);
    return () => {
      clearInterval(i);
      clearInterval(j);
    };
  }, [fetchAgentInfo, fetchSpending, fetchTransactions, pageSize, currentPage]);

  const runAgentTask = useCallback(
    async (task: string, label: string) => {
      if (!agentConnected) {
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Agent not connected. Start services with: npm run dev`,
        );
        return;
      }
      setLoading(true);
      setActiveTask(label);
      addLogEntry(`[${new Date().toLocaleTimeString()}] Starting: ${label}`);
      try {
        const res = await fetch(`${AGENT_URL}/agent/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task }),
        });
        if (!res.ok) {
          const errText = await res.text();
          const errMsg = (() => {
            try {
              return JSON.parse(errText).error;
            } catch {
              return errText.slice(0, 200);
            }
          })();
          addLogEntry(
            `[${new Date().toLocaleTimeString()}] Error (${res.status}): ${errMsg}`,
          );
          return;
        }
        const data: AgentResult = await res.json();
        setAgentResult(data);
        setSpending(data.spending);
        setLiveMessage(`Task complete — ${data.toolCalls.length} tool calls`);
        for (const tc of data.toolCalls) {
          const resultPreview = tc.result?.error
            ? `ERROR: ${String(tc.result.error).slice(0, 60)}`
            : "OK";
          addLogEntry(`  -> ${tc.tool} ${resultPreview}`);
        }
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Done: ${data.toolCalls.length} tool calls`,
        );
        fetchTransactions(pageSize, 0);
        fetchAgentInfo();
      } catch (err: any) {
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Connection error: ${err.message}`,
        );
        setAgentConnected(false);
      } finally {
        setLoading(false);
        setActiveTask("");
      }
    },
    [agentConnected, addLogEntry, fetchAgentInfo, fetchTransactions, pageSize],
  );

  const updatePolicy = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policyForm),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Failed to update policy: ${errText.slice(0, 120)}`,
        );
        return;
      }
      const spendingRes = await fetch(`${AGENT_URL}/agent/spending`);
      if (spendingRes.ok) {
        const data = SpendingDataSchema.parse(await spendingRes.json());
        setSpending(data);
        setPolicyForm(data.policy);
        setPolicyDirty(false);
      }
      addLogEntry(
        `[${new Date().toLocaleTimeString()}] Policy updated: daily=$${policyForm.dailyLimit}, monthly=$${policyForm.monthlyLimit}, meds=$${policyForm.medicationMonthlyBudget}, bills=$${policyForm.billMonthlyBudget}, approval=$${policyForm.approvalThreshold}`,
      );
      setLiveMessage("Policy updated");
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 3000);
    } catch (err: any) {
      addLogEntry(
        `[${new Date().toLocaleTimeString()}] Failed to update policy: ${err.message}`,
      );
    }
  }, [addLogEntry, policyForm]);

  const resetAgent = useCallback(async () => {
    await fetch(`${AGENT_URL}/agent/reset`, { method: "POST" });
    setAllTransactions([]);
    setPagination(null);
    setCurrentPage(0);
    setAgentResult(null);
    setAgentLog([]);
    fetchSpending();
    addLogEntry(
      `[${new Date().toLocaleTimeString()}] Reset by caregiver`,
    );
    setLiveMessage("All transactions and logs cleared");
  }, [addLogEntry, fetchSpending]);

  const togglePause = useCallback(async () => {
    const endpoint = agentPaused ? "/agent/resume" : "/agent/pause";
    try {
      const res = await fetch(`${AGENT_URL}${endpoint}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAgentPaused(data.paused);
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Agent ${data.paused ? "paused" : "resumed"}`,
        );
      }
    } catch {}
  }, [addLogEntry, agentPaused]);

  return {
    // state
    spending,
    allTransactions,
    pagination,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    agentResult,
    loading,
    activeTask,
    agentLog,
    setAgentLog,
    agentInfo,
    agentConnected,
    agentPaused,
    walletBalance,
    walletXlm,
    liveMessage,
    setLiveMessage,
    policyForm,
    setPolicyForm,
    policyDirty,
    setPolicyDirty,
    policySaved,
    // actions
    fetchSpending,
    runAgentTask,
    updatePolicy,
    resetAgent,
    togglePause,
    addLogEntry,
  };
}
