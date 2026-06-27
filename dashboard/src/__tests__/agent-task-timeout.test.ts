import { describe, expect, it } from "vitest";
import {
  AGENT_TASK_CANCELLED_MESSAGE,
  AGENT_TASK_TIMEOUT_MESSAGE,
  AGENT_TASK_TIMEOUT_MS,
  getAgentTaskAbortMessage,
} from "../hooks/agent-task-timeout";

describe("agent task timeout helpers", () => {
  it("uses a 90 second frontend timeout", () => {
    expect(AGENT_TASK_TIMEOUT_MS).toBe(90_000);
  });

  it("returns the timeout message for timeout-triggered aborts", () => {
    expect(getAgentTaskAbortMessage(true)).toBe(
      AGENT_TASK_TIMEOUT_MESSAGE,
    );
    expect(AGENT_TASK_TIMEOUT_MESSAGE).toBe(
      "Agent didn't respond — try again or check status",
    );
  });

  it("keeps user cancellation distinct from timeout aborts", () => {
    expect(getAgentTaskAbortMessage(false)).toBe(
      AGENT_TASK_CANCELLED_MESSAGE,
    );
  });
});
