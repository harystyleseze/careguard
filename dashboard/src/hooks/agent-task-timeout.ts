export const AGENT_TASK_TIMEOUT_MS = 90_000;
export const AGENT_TASK_TIMEOUT_MESSAGE =
  "Agent didn't respond — try again or check status";
export const AGENT_TASK_CANCELLED_MESSAGE = "Cancelled";
export const AGENT_TASK_CANCELLED_TOAST = "Agent task cancelled";

export function getAgentTaskAbortMessage(timedOut: boolean): string {
  return timedOut ? AGENT_TASK_TIMEOUT_MESSAGE : AGENT_TASK_CANCELLED_MESSAGE;
}
