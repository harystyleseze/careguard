import { describe, expect, it } from "vitest";
import { buildAgentTaskLogFields, hashAgentTask } from "../task-log.ts";

describe("agent task logging", () => {
  it("logs a stable hash at info level without raw task text", () => {
    const task = "Ask Rosa Garcia to compare Lisinopril prices";
    const fields = buildAgentTaskLogFields(task, false);

    expect(fields.info).toEqual({
      event: "agent_task_received",
      taskHash: hashAgentTask(task),
      suspicious: false,
    });
    expect(fields.info.taskHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fields.info)).not.toContain("Rosa");
    expect(JSON.stringify(fields.info)).not.toContain("Lisinopril");
  });

  it("logs the full task at debug level with patient and drug specifics redacted", () => {
    const task =
      "Rosa Garcia needs Lisinopril, Metformin, Atorvastatin, and Amlodipine price checks before Maria Garcia approves.";
    const fields = buildAgentTaskLogFields(task, true);

    expect(fields.debug.event).toBe("agent_task_received_debug");
    expect(fields.debug.taskHash).toBe(hashAgentTask(task));
    expect(fields.debug.suspicious).toBe(true);
    expect(fields.debug.redactedTask).toContain("needs");
    expect(fields.debug.redactedTask).toContain("price checks");
    expect(fields.debug.redactedTask).not.toContain("Rosa");
    expect(fields.debug.redactedTask).not.toContain("Maria");
    expect(fields.debug.redactedTask).not.toContain("Lisinopril");
    expect(fields.debug.redactedTask).not.toContain("Metformin");
    expect(fields.debug.redactedTask).toContain("[REDACTED_PERSON]");
    expect(fields.debug.redactedTask).toContain("[REDACTED_MEDICATION]");
  });
});
