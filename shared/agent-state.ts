/**
 * Shared pause-state for the agent.
 *
 * Lives in its own module so background jobs (e.g. wallet balance check) can
 * pause the agent without importing the server module. State is in-memory
 * (single-process). For multi-process deploys this needs to move to Redis or
 * the spending-policy file — but a single-process unified server is the
 * current deploy shape (render.yaml).
 */

export type PauseReason =
  | "manual"
  | "low-balance-usdc"
  | "low-balance-xlm";

let paused = false;
let pausedReason: PauseReason | null = null;
let pausedAt: string | null = null;

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
  return getAgentState();
}

export function resumeAgent(): AgentState {
  paused = false;
  pausedReason = null;
  pausedAt = null;
  return getAgentState();
}

export function isPaused(): boolean {
  return paused;
}
