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
