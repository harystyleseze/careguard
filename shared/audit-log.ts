/**
 * Append-only audit log for high-signal events.
 * Implements #78: Append JSONL records, log events, rotate logs, and expose GET /agent/audit.
 */

import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, renameSync, readFileSync, openSync, readSync, closeSync, writeFileSync } from "fs";
import { Router, Request, Response } from "express";
import { fileURLToPath } from "url";
import lock from "proper-lockfile";
import { createHash } from "crypto";

export function getAuditFilePath(): string {
  const dataDir = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
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

export function appendAuditEntry(entry: AuditEntry): void {
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

    // Acquire lock synchronously to prevent race conditions during write
    release = lock.lockSync(auditFile, { stale: 5000 });

    const lastLine = getLastLine(auditFile);
    let prevHash = "0000000000000000000000000000000000000000000000000000000000000000";

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
    process.stderr.write(`audit-log: failed to write entry: ${err?.message ?? err}\n`);
  } finally {
    if (release) {
      try {
        release();
      } catch (err: any) {
        process.stderr.write(`audit-log: failed to release lock: ${err?.message ?? err}\n`);
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

    if (from) logs = logs.filter(l => new Date(l.timestamp) >= new Date(from as string));
    if (to) logs = logs.filter(l => new Date(l.timestamp) <= new Date(to as string));
    if (event) logs = logs.filter(l => l.event === event);

    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

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
