import { z } from "zod";
import { appendAuditEntry } from "./audit-log.ts";

const BLOCKLIST = [
  "dan ",
  "ignore all instructions",
  "ignore previous instructions",
  "disregard your instructions",
  "jailbreak",
  "act as if",
  "you are now",
  "forget your",
  "new persona",
];

const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;

export const TaskInputSchema = z
  .string()
  .min(10)
  .max(5000)
  .transform((str) => str.replace(CONTROL_CHAR_RE, ""));

let suspiciousTaskTotal = 0;
export function getSuspiciousTaskCount(): number {
  return suspiciousTaskTotal;
}

export interface TaskValidationResult {
  ok: boolean;
  task?: string;
  error?: string;
  suspicious: boolean;
}

export function validateTask(raw: unknown): TaskValidationResult {
  const parsed = TaskInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, suspicious: false };
  }

  const stripped = parsed.data;

  // Only a JSON object can carry a "role" key, so skip the parse (and the
  // exception it throws for every normal task) unless the task looks like one.
  // This was most of validateTask's cost per call (#1312).
  if (stripped.trimStart().startsWith("{")) {
    try {
      const asJson = JSON.parse(stripped);
      if (asJson && typeof asJson === "object" && "role" in asJson) {
        return { ok: false, error: "Task contains disallowed content", suspicious: true };
      }
    } catch {
      // Not valid JSON — treat as a normal task string
    }
  }

  const lower = stripped.toLowerCase();
  const hit = BLOCKLIST.find((token) => lower.includes(token));
  if (hit) {
    suspiciousTaskTotal++;
    appendAuditEntry({
      event: "task.suspicious",
      actor: "api",
      details: { blocklist_hit: hit },
    });
    return { ok: true, task: stripped, suspicious: true };
  }

  return { ok: true, task: stripped, suspicious: false };
}
