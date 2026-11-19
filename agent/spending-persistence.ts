/**
 * Spending Persistence Module (Issue #1002)
 *
 * Implements atomic snapshots, JSONL append-only transaction logs, and corruption rotation.
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { z } from "zod";
import { logger } from "../shared/logger.ts";
import type { Transaction } from "../shared/types.ts";

export const SpendingTrackerSchema = z.object({
  medications: z.number().nonnegative().default(0),
  bills: z.number().nonnegative().default(0),
  serviceFees: z.number().nonnegative().default(0),
  transactions: z.array(z.any()).default([]),
});

export type SpendingTracker = z.infer<typeof SpendingTrackerSchema>;

export function writeAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  try {
    writeFileSync(tempPath, content, "utf-8");
    renameSync(tempPath, filePath);
  } catch (err) {
    throw err;
  }
}

export function rotateCorruptedFile(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatedPath = `${filePath}.corrupt-${timestamp}`;
  try {
    renameSync(filePath, rotatedPath);
    logger.error({ original: filePath, rotated: rotatedPath }, "[Persistence] Rotated corrupted file");
  } catch (err) {
    logger.error({ file: filePath, error: err }, "[Persistence] Failed to rotate corrupted file");
  }
  return rotatedPath;
}

export function createEmptySpendingTracker(): SpendingTracker {
  return {
    medications: 0,
    bills: 0,
    serviceFees: 0,
    transactions: [],
  };
}

export function appendTransactionToLog(logFile: string, tx: Transaction): void {
  const dir = logFile.slice(0, logFile.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(logFile, JSON.stringify(tx) + "\n", "utf-8");
}

export function compactSnapshot(snapshotFile: string, tracker: SpendingTracker): void {
  const payload = {
    ...tracker,
    _snapshotTxCount: tracker.transactions.length,
    _compactedAt: new Date().toISOString(),
  };
  writeAtomically(snapshotFile, JSON.stringify(payload, null, 2));
}
