import type { SpendingData, Transaction } from "../lib/types";

export type { SpendingData, Transaction };

export interface AgentResult {
  response: string;
  toolCalls: Array<{ tool: string; input: unknown; result: any }>;
  spending: SpendingData;
  llmUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface AgentInfo {
  service: string;
  agentWallet: string;
  llm: string;
  network: string;
  paused?: boolean;
}

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  message: string;
}

export interface PaginationData {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
}

export const DASHBOARD_TABS = [
  "overview",
  "medications",
  "bills",
  "approvals",
  "policy",
  "wallet",
  "activity",
  "settings",
] as const;

export type Tab = (typeof DASHBOARD_TABS)[number];
