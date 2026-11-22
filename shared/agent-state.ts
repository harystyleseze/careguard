/**
 * Shared pause-state for the agent.
 *
 * Lives in its own module so background jobs (e.g. wallet balance check) can
 * pause the agent without importing the server module.
 *
 * Pause state is persisted to DATA_DIR/agent-state.json (atomic tmp+rename,
 * same pattern as agent/server.ts) so a caregiver-initiated pause survives a
 * process restart (#1030).  DATA_DIR defaults to ./data relative to the
 * module file; override with the DATA_DIR environment variable.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ActionReasoning } from "./action-reasoning.ts";

export type PauseReason =
  | "manual"
  | "low-balance-usdc"
  | "low-balance-xlm";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function getStateFile(): string {
  const dataDir =
    process.env.DATA_DIR ||
    fileURLToPath(new URL("../data", import.meta.url));
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return `${dataDir}/agent-state.json`;
}

interface PersistedState {
  paused: boolean;
  pausedReason: PauseReason | null;
  pausedAt: string | null;
}

function loadPersistedState(): PersistedState {
  try {
    const file = getStateFile();
    if (!existsSync(file)) return { paused: false, pausedReason: null, pausedAt: null };
    return JSON.parse(readFileSync(file, "utf-8")) as PersistedState;
  } catch {
    return { paused: false, pausedReason: null, pausedAt: null };
  }
}

function saveState(state: PersistedState): void {
  try {
    const file = getStateFile();
    const tmp = `${file}.tmp-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(state), "utf-8");
    renameSync(tmp, file);
  } catch {
    // persistence failure is non-fatal; in-memory state remains authoritative
  }
}

// ---------------------------------------------------------------------------
// Module-level state — initialised from disk on first import
// ---------------------------------------------------------------------------

const _initial = loadPersistedState();
let paused = _initial.paused;
let pausedReason: PauseReason | null = _initial.pausedReason;
let pausedAt: string | null = _initial.pausedAt;

export interface AgentState {
  paused: boolean;
  pausedReason: PauseReason | null;
  pausedAt: string | null;
}

export function getAgentState(): AgentState {
  return { paused, pausedReason, pausedAt };
}

export function pauseAgent(reason: PauseReason): AgentState {
  paused = true;
  pausedReason = reason;
  pausedAt = new Date().toISOString();
  saveState({ paused, pausedReason, pausedAt });
  return getAgentState();
}

export function resumeAgent(): AgentState {
  paused = false;
  pausedReason = null;
  pausedAt = null;
  saveState({ paused, pausedReason, pausedAt });
  return getAgentState();
}

export function isPaused(): boolean {
  return paused;
}

// ---------------------------------------------------------------------------
// Action reasoning traces (#1235)
// ---------------------------------------------------------------------------
//
// A plain-language "why did this happen?" summary per significant agent
// action (see shared/action-reasoning.ts), persisted to
// DATA_DIR/action-reasoning.json so the dashboard can show it for past
// actions too. Entries are redacted before they get here.

/** History kept on disk; older entries are dropped first. */
export const MAX_ACTION_REASONING_ENTRIES = 500;

function getReasoningFile(): string {
  return getStateFile().replace(/agent-state\.json$/, "action-reasoning.json");
}

function loadReasoning(): ActionReasoning[] {
  try {
    const file = getReasoningFile();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Appends entries (oldest first on disk) and trims to the newest MAX_ACTION_REASONING_ENTRIES. */
export function recordActionReasoning(entries: readonly ActionReasoning[]): void {
  if (entries.length === 0) return;
  const all = [...loadReasoning(), ...entries].slice(-MAX_ACTION_REASONING_ENTRIES);
  try {
    const file = getReasoningFile();
    const tmp = `${file}.tmp-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(all), "utf-8");
    renameSync(tmp, file);
  } catch {
    // Non-fatal: the action itself already happened; only its explanation is lost.
  }
}

/** Newest first, optionally only the trace for one transaction or tool call. */
export function listActionReasoning(options: {
  limit?: number;
  transactionId?: string;
  toolCallId?: string;
} = {}): ActionReasoning[] {
  const limit = Math.min(Math.max(1, options.limit ?? 50), MAX_ACTION_REASONING_ENTRIES);
  return loadReasoning()
    .reverse()
    .filter(
      (entry) =>
        (!options.transactionId || entry.transactionId === options.transactionId) &&
        (!options.toolCallId || entry.toolCallId === options.toolCallId),
    )
    .slice(0, limit);
}
