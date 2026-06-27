import { createHash } from "crypto";
import { redactAgentTaskText } from "../shared/redact.ts";

export function hashAgentTask(task: string): string {
  return createHash("sha256").update(task).digest("hex");
}

export function buildAgentTaskLogFields(
  task: string,
  suspicious: boolean,
): {
  info: { event: string; taskHash: string; suspicious: boolean };
  debug: {
    event: string;
    taskHash: string;
    suspicious: boolean;
    redactedTask: string;
  };
} {
  const taskHash = hashAgentTask(task);

  return {
    info: {
      event: "agent_task_received",
      taskHash,
      suspicious,
    },
    debug: {
      event: "agent_task_received_debug",
      taskHash,
      suspicious,
      redactedTask: redactAgentTaskText(task),
    },
  };
}
