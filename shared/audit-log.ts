/**
 * Append-only audit log for high-signal events.
 * Implements #78: Append JSONL records, log events, rotate logs, and expose GET /agent/audit.
 *
 * File locking — proper-lockfile (issue #1386): v4.1.2 is the latest release
 * (published 2022-06-24) and no newer major exists; the package is a stable,
 * widely used cooperative file-lock primitive with no known vulnerabilities. We
 * intentionally stay on it rather than migrating to a Redis-based lock because
 * this lock must work when REDIS_URL is unset (the app falls back to in-process
 * state), so a Redis lock cannot replace it without changing semantics. See
 * docs/tech-stack.md → "Dependency version pairing".
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  renameSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  writeFileSync,
  promises as fsPromises,
} from "fs";
import { Router, Request, Response } from "express";
import { fileURLToPath } from "url";
import lock from "proper-lockfile";
import { createHash } from "crypto";

export function getAuditFilePath(): string {
  if (process.env.AUDIT_LOG_FILE) return process.env.AUDIT_LOG_FILE;
  const dataDir =
    process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return `${dataDir}/audit.log.jsonl`;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVES = 12;

export interface AuditEntry {
  event: string;
  actor: string;
  details?: Record<string, unknown>;
}

export function canonicalize(val: any): string {
  if (val === null) return "null";
  if (Array.isArray(val)) {
    return "[" + val.map(canonicalize).join(",") + "]";
  }
  if (typeof val === "object") {
    const keys = Object.keys(val).sort();
    const parts = keys.map((key) => {
      const escapedKey = JSON.stringify(key);
      const valStr = canonicalize(val[key]);
      return `${escapedKey}:${valStr}`;
    });
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(val);
}

export function getLastLine(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const stat = statSync(filePath);
  if (stat.size === 0) return null;

  const fd = openSync(filePath, "r");
  try {
    const bufferSize = 1024;
    const buffer = Buffer.alloc(bufferSize);
    let position = stat.size;
    let lastLine = "";

    while (position > 0) {
      const length = Math.min(position, bufferSize);
      position -= length;
      readSync(fd, buffer, 0, length, position);

      const chunk = buffer.toString("utf8", 0, length);
      lastLine = chunk + lastLine;

      const newlineIndex = lastLine.lastIndexOf("\n", lastLine.length - 2);
      if (newlineIndex !== -1) {
        lastLine = lastLine.slice(newlineIndex + 1);
        break;
      }
    }
    const trimmed = lastLine.trim();
    return trimmed || null;
  } finally {
    closeSync(fd);
  }
}

export async function getLastLineAsync(filePath: string): Promise<string | null> {
  try {
    const stat = await fsPromises.stat(filePath);
    if (stat.size === 0) return null;

    const fileHandle = await fsPromises.open(filePath, "r");
    try {
      const bufferSize = 1024;
      const buffer = Buffer.alloc(bufferSize);
      let position = stat.size;
      let lastLine = "";

      while (position > 0) {
        const length = Math.min(position, bufferSize);
        position -= length;
        const { bytesRead } = await fileHandle.read(buffer, 0, length, position);

        const chunk = buffer.toString("utf8", 0, bytesRead);
        lastLine = chunk + lastLine;

        const newlineIndex = lastLine.lastIndexOf("\n", lastLine.length - 2);
        if (newlineIndex !== -1) {
          lastLine = lastLine.slice(newlineIndex + 1);
          break;
        }
      }
      const trimmed = lastLine.trim();
      return trimmed || null;
    } finally {
      await fileHandle.close();
    }
  } catch {
    return null;
  }
}

async function rotateLogsAsync(): Promise<void> {
  const auditFile = getAuditFilePath();
  try {
    const stats = await fsPromises.stat(auditFile);
    if (stats.size >= MAX_FILE_SIZE) {
      const oldestLog = `${auditFile}.${MAX_ARCHIVES}`;
      try {
        await fsPromises.unlink(oldestLog);
      } catch {}
      for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
        const currentLog = `${auditFile}.${i}`;
        const nextLog = `${auditFile}.${i + 1}`;
        try {
          await fsPromises.rename(currentLog, nextLog);
        } catch {}
      }
      await fsPromises.rename(auditFile, `${auditFile}.1`);
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      process.stderr.write(`audit-log: failed to rotate logs: ${err}\n`);
    }
  }
}

function rotateLogs() {
  const auditFile = getAuditFilePath();
  try {
    if (existsSync(auditFile)) {
      const stats = statSync(auditFile);
      if (stats.size >= MAX_FILE_SIZE) {
        const oldestLog = `${auditFile}.${MAX_ARCHIVES}`;
        if (existsSync(oldestLog)) unlinkSync(oldestLog);
        for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
          const currentLog = `${auditFile}.${i}`;
          const nextLog = `${auditFile}.${i + 1}`;
          if (existsSync(currentLog)) renameSync(currentLog, nextLog);
        }
        renameSync(auditFile, `${auditFile}.1`);
      }
    }
  } catch (err) {
    process.stderr.write(`audit-log: failed to rotate logs: ${err}\n`);
  }
}

export function appendAuditEntrySync(entry: AuditEntry): void {
  rotateLogs();

  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const auditFile = getAuditFilePath();

  let release: (() => void) | undefined;
  try {
    if (!existsSync(auditFile)) {
      writeFileSync(auditFile, "", "utf-8");
    }

    release = lock.lockSync(auditFile, { stale: 5000 });

    const lastLine = getLastLine(auditFile);
    let prevHash =
      "0000000000000000000000000000000000000000000000000000000000000000";

    if (lastLine) {
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed && typeof parsed.hash === "string") {
          prevHash = parsed.hash;
        }
      } catch (e) {
        // Fallback to genesis prevHash if last entry is malformed
      }
    }

    const serializedPayload = canonicalize(payload);
    const hashInput = prevHash + serializedPayload;
    const hash = createHash("sha256").update(hashInput).digest("hex");

    const line = JSON.stringify({
      ...payload,
      prevHash,
      hash,
    });

    appendFileSync(auditFile, line + "\n");
  } catch (err: any) {
    process.stderr.write(
      `audit-log: failed to write entry: ${err?.message ?? err}\n`,
    );
  } finally {
    if (release) {
      try {
        release();
      } catch (err: any) {
        process.stderr.write(
          `audit-log: failed to release lock: ${err?.message ?? err}\n`,
        );
      }
    }
  }
}

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  await rotateLogsAsync();

  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const auditFile = getAuditFilePath();

  let release: (() => Promise<void>) | undefined;
  try {
    try {
      await fsPromises.access(auditFile);
    } catch {
      await fsPromises.writeFile(auditFile, "", "utf-8");
    }

    // Acquire lock asynchronously to prevent blocking event loop (Issue #1011)
    release = await lock.lock(auditFile, {
      stale: 5000,
      retries: {
        retries: 30,
        factor: 1.1,
        minTimeout: 30,
        maxTimeout: 150,
        randomize: true,
      },
    });

    const lastLine = await getLastLineAsync(auditFile);
    let prevHash =
      "0000000000000000000000000000000000000000000000000000000000000000";

    if (lastLine) {
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed && typeof parsed.hash === "string") {
          prevHash = parsed.hash;
        }
      } catch (e) {
        // Fallback to genesis prevHash if last entry is malformed
      }
    }

    const serializedPayload = canonicalize(payload);
    const hashInput = prevHash + serializedPayload;
    const hash = createHash("sha256").update(hashInput).digest("hex");

    const line = JSON.stringify({
      ...payload,
      prevHash,
      hash,
    });

    await fsPromises.appendFile(auditFile, line + "\n", "utf-8");
  } catch (err: any) {
    process.stderr.write(
      `audit-log: failed to write entry: ${err?.message ?? err}\n`,
    );
  } finally {
    if (release) {
      try {
        await release();
      } catch (err: any) {
        process.stderr.write(
          `audit-log: failed to release lock: ${err?.message ?? err}\n`,
        );
      }
    }
  }
}

export const AUDIT_FILE_PATH = getAuditFilePath();

export const auditRouter: import("express").Router = Router();

// Middleware to check admin (assuming a basic check or skipped for now as per instructions)
const requireAdmin = (req: Request, res: Response, next: Function) => {
  // Add admin check logic here if available, otherwise proceed.
  next();
};

auditRouter.get("/", requireAdmin, (req: Request, res: Response) => {
  try {
    const { from, to, event, page = "1", limit = "50" } = req.query;
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 50;
    const auditFile = getAuditFilePath();

    if (!existsSync(auditFile)) {
      return res.json({ data: [], total: 0 });
    }

    const fileContent = readFileSync(auditFile, "utf-8");
    const lines = fileContent.trim().split("\n");

    let logs: any[] = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        logs.push(JSON.parse(line));
      } catch (e) {
        // Skip malformed lines
      }
    }

    if (from)
      logs = logs.filter(
        (l) => new Date(l.timestamp) >= new Date(from as string),
      );
    if (to)
      logs = logs.filter(
        (l) => new Date(l.timestamp) <= new Date(to as string),
      );
    if (event) logs = logs.filter((l) => l.event === event);

    logs.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const startIndex = (pageNum - 1) * limitNum;
    const paginatedLogs = logs.slice(startIndex, startIndex + limitNum);

    res.json({
      data: paginatedLogs,
      total: logs.length,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error reading audit logs" });
  }
});

export function readAuditLog(): Array<{ event: string; actor: string; details?: any; timestamp: string }> {
  const filePath = getAuditFilePath();
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
// ── Caregiver-facing audit export (Feature: accountability report) ────────────

/**
 * Audit event names that are meaningful to caregivers.
 * Internal-only technical events (tool_call, iteration_limit_reached, etc.) are excluded.
 */
export const CAREGIVER_AUDIT_EVENTS = new Set([
  "policy.updated",
  "spending.reset",
  "agent.policy_updated",
  "agent.reset",
  "agent.paused",
  "agent.resumed",
  "agent.auto-paused",
  "order.status_updated",
]);

/**
 * GET /agent/audit/caregiver-export
 *
 * Returns a filtered, paginated list of caregiver-relevant audit entries.
 * Supports date-range filtering via `from` / `to` ISO query params.
 * Response format is identical to GET /agent/audit so the dashboard can
 * reuse the same parsing logic.
 */
auditRouter.get(
  "/caregiver-export",
  requireAdmin,
  (req: Request, res: Response) => {
    try {
      const { from, to, page = "1", limit = "50" } = req.query;
      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(
        200,
        Math.max(1, parseInt(limit as string, 10) || 50),
      );
      const auditFile = getAuditFilePath();

      if (!existsSync(auditFile)) {
        return res.json({ data: [], total: 0 });
      }

      const fileContent = readFileSync(auditFile, "utf-8");
      const lines = fileContent.trim().split("\n");

      let logs: any[] = [];
      for (const line of lines) {
        if (!line) continue;
        try {
          logs.push(JSON.parse(line));
        } catch {
          // Skip malformed lines
        }
      }

      // Filter to caregiver-relevant events only
      logs = logs.filter((l) => CAREGIVER_AUDIT_EVENTS.has(l.event));

      // Date-range filter
      if (from)
        logs = logs.filter(
          (l) => new Date(l.timestamp) >= new Date(from as string),
        );
      if (to)
        logs = logs.filter(
          (l) => new Date(l.timestamp) <= new Date(to as string),
        );

      // Sort newest-first
      logs.sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      const total = logs.length;
      const startIndex = (pageNum - 1) * limitNum;
      const paginatedLogs = logs.slice(startIndex, startIndex + limitNum);

      res.json({
        data: paginatedLogs,
        total,
        page: pageNum,
        limit: limitNum,
      });
    } catch {
      res
        .status(500)
        .json({ error: "Internal server error reading audit logs" });
    }
  },
);

export function verifyAuditLog(filePath?: string): {
  valid: boolean;
  entries: number;
  corruptedLine?: number;
  error?: string;
} {
  const target = filePath || getAuditFilePath();
  if (!existsSync(target)) return { valid: true, entries: 0 };
  const content = readFileSync(target, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  let prevExpectedHash =
    "0000000000000000000000000000000000000000000000000000000000000000";

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed.prevHash !== prevExpectedHash) {
        return {
          valid: false,
          entries: i,
          corruptedLine: i + 1,
          error: `prevHash mismatch at line ${i + 1}`,
        };
      }
      const { prevHash: _p, hash: currentHash, ...payload } = parsed;
      const calculated = createHash("sha256")
        .update(prevExpectedHash + canonicalize(payload))
        .digest("hex");
      if (calculated !== currentHash) {
        return {
          valid: false,
          entries: i,
          corruptedLine: i + 1,
          error: `hash mismatch at line ${i + 1}`,
        };
      }
      prevExpectedHash = currentHash;
    } catch (e: any) {
      return { valid: false, entries: i, corruptedLine: i + 1, error: e.message };
    }
  }
  return { valid: true, entries: lines.length };
}
