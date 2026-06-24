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

const taskSchema = z.string().min(10).max(5000);

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
  const parsed = taskSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0].message, suspicious: false };
  }

  const stripped = parsed.data.replace(CONTROL_CHAR_RE, "");

  // Hard-reject if task is valid JSON containing a "role" key — natural-language
  // tasks never parse as JSON. This resists Unicode/whitespace bypass that simple
  // string matching on `"role": "system"` cannot handle.
  try {
    const asJson = JSON.parse(stripped);
    if (asJson && typeof asJson === "object" && "role" in asJson) {
      return { ok: false, error: "Task contains disallowed content", suspicious: true };
    }
  } catch {
    // Expected — normal task strings are not JSON
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
