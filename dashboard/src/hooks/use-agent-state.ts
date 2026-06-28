'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  SpendingDataSchema,
  TransactionSchema,
  AuditLogSchema,
  type SpendingData,
  type Transaction,
} from '../lib/types';
import type {
  AgentInfo,
  AgentLogEntry,
  AgentResult,
  PaginationData,
  Tab,
  AuditLogEvent,
} from '../components/types';
import { usePoll } from './use-poll';
import { AGENT_URL } from '../lib/agent-url';


const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 86400,
};

export type PolicyForm = typeof DEFAULT_POLICY;

export interface UseAgentStateOptions {
  activeTab: Tab;
}

export function useAgentState({ activeTab }: UseAgentStateOptions) {
  const [spending, setSpending] = useState<SpendingData | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditLogEvent[]>([]);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [agentResult, setAgentResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTask, setActiveTask] = useState('');
  const [agentLog, setAgentLog] = useState<AgentLogEntry[]>([]);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [agentPaused, setAgentPaused] = useState(false);
  const [agentPausedReason, setAgentPausedReason] = useState<string | null>(
    null,
  );
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [walletXlm, setWalletXlm] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [policyForm, setPolicyForm] = useState<PolicyForm>(DEFAULT_POLICY);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [policySaved, setPolicySaved] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Individual loading states for each data source (Issue #283)
  const [loadingAgentInfo, setLoadingAgentInfo] = useState(false);
  const [loadingSpending, setLoadingSpending] = useState(false);
  const [loadingTransactions, setLoadingTransactions] = useState(false);

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
      ? 'disconnected'
      : agentPaused
        ? 'paused'
        : 'active';
    const prev = lastConnectionStateRef.current;
    if (prev === connectionState) return;
    lastConnectionStateRef.current = connectionState;
    if (connectionState === 'active') setLiveMessage('Agent connected');
    if (connectionState === 'paused') setLiveMessage('Agent paused');
    if (connectionState === 'disconnected')
      setLiveMessage('Agent disconnected');
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
    setLoadingAgentInfo(true);
    try {
      const res = await fetch(`${AGENT_URL}/`);
      if (!res.ok) {
        setAgentConnected(false);
        setLoadingAgentInfo(false);
        return;
      }
      const data = await res.json();
      setAgentInfo(data);
      setAgentConnected(true);
      setAgentPaused(Boolean(data.paused));
      setAgentPausedReason(
        typeof data.pausedReason === 'string' ? data.pausedReason : null,
      );
      // Fetch wallet balance from server (Issue #134 - server-side cache)
      if (data.agentWallet) {
        try {
          const wres = await fetch(`${AGENT_URL}/agent/wallet`);
          if (wres.ok) {
            const wdata = await wres.json();
            setWalletBalance(wdata.usdc || '0.00');
            setWalletXlm(wdata.xlm || '0.00');
          }
        } catch {}
      }
    } catch {
      setAgentConnected(false);
    } finally {
      setLoadingAgentInfo(false);
    }
  }, []);

  const fetchSpending = useCallback(
    async (opts?: { forcePolicySync?: boolean }) => {
      setLoadingSpending(true);
      try {
        const res = await fetch(`${AGENT_URL}/agent/spending`);
        if (!res.ok) {
          setLoadingSpending(false);
          return;
        }
        const data = SpendingDataSchema.parse(await res.json());
        setSpending(data);
        const forcePolicySync = Boolean(opts?.forcePolicySync);
        const shouldSyncPolicy =
          forcePolicySync ||
          (activeTabRef.current !== 'policy' && !policyDirtyRef.current);
        if (shouldSyncPolicy) {
          setPolicyForm(data.policy);
          setPolicyDirty(false);
        }
      } catch {} finally {
        setLoadingSpending(false);
      }
    },
    [],
  );

  const fetchTransactions = useCallback(
    async (limit?: number, offset?: number) => {
      setLoadingTransactions(true);
      try {
        const params = new URLSearchParams();
        if (limit) params.append('limit', limit.toString());
        if (offset) params.append('offset', offset.toString());
        const res = await fetch(`${AGENT_URL}/agent/transactions?${params}`);
        if (!res.ok) {
          setLoadingTransactions(false);
          return;
        }
        const data = await res.json();
        // Sort newest-first once here so downstream consumers never need to
        // sort on every render (Issue #220).
        const txs = Array.isArray(data.transactions)
          ? data.transactions
              .map((t: unknown) => TransactionSchema.parse(t))
              .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          : [];
        setAllTransactions(txs);
        if (data.pagination) setPagination(data.pagination);

        // Fetch audit events independently (don't block on this)
        const auditRes = await fetch(`${AGENT_URL}/agent/audit?limit=100`);
        if (auditRes.ok) {
          const auditData = await auditRes.json();
          const logs = Array.isArray(auditData.data)
            ? auditData.data.map((l: unknown) => AuditLogSchema.parse(l))
            : [];
          setAuditEvents(logs);
        }
      } catch {} finally {
        setLoadingTransactions(false);
      }
    },
    [],
  );

  // Poll spending and transactions every 3s with backoff
  const spendingPoll = usePoll({
    intervalMs: 3000,
    enabled: true,
    onPoll: async () => {
      await fetchSpending();
      await fetchTransactions(pageSize, currentPage * pageSize);
    },
    onError: (error) => {
      console.error('[Poll] Spending/transactions poll error:', error.message);
    },
  });

  // Poll agent info every 10s with backoff
  const agentInfoPoll = usePoll({
    intervalMs: 10000,
    enabled: true,
    onPoll: fetchAgentInfo,
    onError: (error) => {
      console.error('[Poll] Agent info poll error:', error.message);
    },
  });

  // Initial fetch on mount
  useEffect(() => {
    fetchAgentInfo();
    fetchSpending();
    fetchTransactions(pageSize, currentPage * pageSize);
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
      
      const controller = new AbortController();
      setAbortController(controller);
      
      const timeoutId = setTimeout(() => {
        controller.abort();
        addLogEntry(`[${new Date().toLocaleTimeString()}] Agent task timed out`);
      }, 60000);
      
      try {
        const res = await fetch(`${AGENT_URL}/agent/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
          signal: controller.signal,
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
          toast.error(`Agent error (${res.status}): ${errMsg}`);
          return;
        }
        const data: AgentResult = await res.json();
        setAgentResult(data);
        setSpending(data.spending);
        setLiveMessage(`Task complete — ${data.toolCalls.length} tool calls`);
        for (const tc of data.toolCalls) {
          const resultPreview = tc.result?.error
            ? `ERROR: ${String(tc.result.error).slice(0, 60)}`
            : 'OK';
          addLogEntry(`  -> ${tc.tool} ${resultPreview}`);
        }
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Done: ${data.toolCalls.length} tool calls`,
        );
        fetchTransactions(pageSize, 0);
        fetchAgentInfo();
      } catch (err: any) {
        if (err.name === 'AbortError') {
          addLogEntry(
            `[${new Date().toLocaleTimeString()}] Cancelled`,
          );
          toast.error('Agent task cancelled');
        } else {
          addLogEntry(
            `[${new Date().toLocaleTimeString()}] Connection error: ${err.message}`,
          );
          toast.error(`Connection error: ${err.message}`);
          setAgentConnected(false);
        }
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
        setActiveTask('');
        setAbortController(null);
      }
    },
    [agentConnected, addLogEntry, fetchAgentInfo, fetchTransactions, pageSize],
  );

  const cancelAgentTask = useCallback(() => {
    if (abortController) {
      abortController.abort();
    }
  }, [abortController]);

  const updatePolicy = useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
  }> => {
    try {
      const res = await fetch(`${AGENT_URL}/agent/policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policyForm),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Failed to update policy: ${errText.slice(0, 120)}`,
        );
        return { ok: false, error: errText || 'Failed to update policy' };
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
      setLiveMessage('Policy updated');
      setPolicySaved(true);
      setTimeout(() => setPolicySaved(false), 3000);
      return { ok: true };
    } catch (err: any) {
      addLogEntry(
        `[${new Date().toLocaleTimeString()}] Failed to update policy: ${err.message}`,
      );
      return { ok: false, error: err.message };
    }
  }, [addLogEntry, policyForm]);

  const resetAgent = useCallback(async () => {
    await fetch(`${AGENT_URL}/agent/reset`, { method: 'POST' });
    setAllTransactions([]);
    setPagination(null);
    setCurrentPage(0);
    setAgentResult(null);
    setAgentLog([]);
    fetchSpending();
    addLogEntry(`[${new Date().toLocaleTimeString()}] Reset by caregiver`);
    setLiveMessage('All transactions and logs cleared');
  }, [addLogEntry, fetchSpending]);

  const togglePause = useCallback(async () => {
    const endpoint = agentPaused ? '/agent/resume' : '/agent/pause';
    try {
      const res = await fetch(`${AGENT_URL}${endpoint}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setAgentPaused(data.paused);
        setAgentPausedReason(
          typeof data.pausedReason === 'string' ? data.pausedReason : null,
        );
        addLogEntry(
          `[${new Date().toLocaleTimeString()}] Agent ${data.paused ? 'paused' : 'resumed'}`,
        );
      }
    } catch {}
  }, [addLogEntry, agentPaused]);

  return {
    // state
    spending,
    allTransactions,
    auditEvents,
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
    agentPausedReason,
    walletBalance,
    walletXlm,
    liveMessage,
    setLiveMessage,
    policyForm,
    setPolicyForm,
    policyDirty,
    setPolicyDirty,
    policySaved,
    // individual loading states (Issue #283)
    loadingAgentInfo,
    loadingSpending,
    loadingTransactions,
    // actions
    fetchSpending,
    runAgentTask,
    cancelAgentTask,
    updatePolicy,
    resetAgent,
    togglePause,
    addLogEntry,
  };
}
