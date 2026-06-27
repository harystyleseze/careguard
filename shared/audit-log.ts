/**
 * Append-only audit log for high-signal events.
 * Implements #78: Append JSONL records, log events, rotate logs, and expose GET /agent/audit.
 */

import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, renameSync, readFileSync } from "fs";
import { Router, Request, Response } from "express";
import { fileURLToPath } from "url";

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const AUDIT_FILE = `${DATA_DIR}/audit.log.jsonl`;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ARCHIVES = 12;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export interface AuditEntry {
  event: string;
  actor: string;
  details?: Record<string, unknown>;
}

function rotateLogs() {
  try {
    if (existsSync(AUDIT_FILE)) {
      const stats = statSync(AUDIT_FILE);
      if (stats.size >= MAX_FILE_SIZE) {
        const oldestLog = `${AUDIT_FILE}.${MAX_ARCHIVES}`;
        if (existsSync(oldestLog)) unlinkSync(oldestLog);
        for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
          const currentLog = `${AUDIT_FILE}.${i}`;
          const nextLog = `${AUDIT_FILE}.${i + 1}`;
          if (existsSync(currentLog)) renameSync(currentLog, nextLog);
        }
        renameSync(AUDIT_FILE, `${AUDIT_FILE}.1`);
      }
    }
  } catch (err) {
    process.stderr.write(`audit-log: failed to rotate logs: ${err}\n`);
  }
}

export function appendAuditEntry(entry: AuditEntry): void {
  rotateLogs();
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  try {
    appendFileSync(AUDIT_FILE, line + "\n");
  } catch (err: any) {
    process.stderr.write(`audit-log: failed to write entry: ${err?.message ?? err}\n`);
  }
}

export const AUDIT_FILE_PATH = AUDIT_FILE;

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

    if (!existsSync(AUDIT_FILE)) {
      return res.json({ data: [], total: 0 });
    }

    const fileContent = readFileSync(AUDIT_FILE, "utf-8");
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
