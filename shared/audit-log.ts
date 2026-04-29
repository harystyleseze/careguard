/**
 * Append-only audit log for high-signal events (auto-pause, policy changes,
 * security-relevant actions). Stub for #72 — the real audit trail will live
 * in a database. Today: JSONL file at data/audit.log.jsonl.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";

const DATA_DIR = new URL("../data", import.meta.url).pathname;
const AUDIT_FILE = `${DATA_DIR}/audit.log.jsonl`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export interface AuditEntry {
  event: string;
  actor: string;
  details?: Record<string, unknown>;
}

export function appendAuditEntry(entry: AuditEntry): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  try {
    appendFileSync(AUDIT_FILE, line + "\n");
  } catch (err: any) {
    // Audit logging must never crash the caller, but we want to know.
    console.warn(`  ⚠ audit-log: failed to write entry: ${err?.message ?? err}`);
  }
}

export const AUDIT_FILE_PATH = AUDIT_FILE;
