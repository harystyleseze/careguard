/**
 * Append-only journal for crash-safe state persistence.
 *
 * Every state change is written as a JSON line to a journal file BEFORE
 * the in-memory state is mutated. On boot, the journal is replayed to
 * reconstruct state. Periodic compaction snapshots the current state and
 * truncates the journal.
 *
 * This prevents data loss when a crash occurs mid-write.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "fs";
import { logger } from "../shared/logger.ts";

export interface JournalEntry {
  op: string;
  data: unknown;
  ts: number;
}

export class Journal {
  private journalPath: string;
  private snapshotPath: string;
  private entryCount = 0;
  private compactionThreshold: number;

  constructor(opts: {
    journalPath: string;
    snapshotPath: string;
    compactionThreshold?: number;
  }) {
    this.journalPath = opts.journalPath;
    this.snapshotPath = opts.snapshotPath;
    this.compactionThreshold = opts.compactionThreshold ?? 100;
  }

  /** Append a state-change entry to the journal. */
  append(op: string, data: unknown): void {
    const entry: JournalEntry = { op, data, ts: Date.now() };
    appendFileSync(this.journalPath, JSON.stringify(entry) + "\n");
    this.entryCount++;

    if (this.entryCount >= this.compactionThreshold) {
      this.compact(data as Record<string, unknown>);
    }
  }

  /** Replay the journal to reconstruct state from a snapshot. */
  replay<T>(initial: T, ops: Record<string, (state: T, data: unknown) => T>): T {
    let state = initial;

    // Load snapshot if it exists
    if (existsSync(this.snapshotPath)) {
      try {
        const snapshot = JSON.parse(readFileSync(this.snapshotPath, "utf-8"));
        state = snapshot.state as T;
        this.entryCount = snapshot.entryCount ?? 0;
        logger.info({ entryCount: this.entryCount }, "[Journal] loaded snapshot");
      } catch (err) {
        logger.warn({ err }, "[Journal] failed to load snapshot, replaying from scratch");
        state = initial;
        this.entryCount = 0;
      }
    }

    // Replay journal entries after snapshot
    if (existsSync(this.journalPath)) {
      try {
        const lines = readFileSync(this.journalPath, "utf-8")
          .split("\n")
          .filter(Boolean);
        for (const line of lines) {
          try {
            const entry: JournalEntry = JSON.parse(line);
            const handler = ops[entry.op];
            if (handler) {
              state = handler(state, entry.data);
            }
          } catch {
            // Skip corrupt lines — they were written before a crash
            logger.warn({ line: line.slice(0, 80) }, "[Journal] skipping corrupt entry");
          }
        }
        logger.info({ replayed: lines.length }, "[Journal] replayed entries");
      } catch (err) {
        logger.warn({ err }, "[Journal] failed to read journal, using snapshot only");
      }
    }

    return state;
  }

  /** Compact: snapshot current state and truncate the journal. */
  compact(state: Record<string, unknown>): void {
    const tmpPath = this.snapshotPath + ".tmp";
    try {
      writeFileSync(
        tmpPath,
        JSON.stringify({ state, entryCount: 0, compactedAt: Date.now() }),
      );
      renameSync(tmpPath, this.snapshotPath);
      // Truncate journal
      writeFileSync(this.journalPath, "");
      this.entryCount = 0;
      logger.info("[Journal] compaction complete");
    } catch (err) {
      logger.error({ err }, "[Journal] compaction failed");
      // Clean up temp file on failure
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /** Get the number of entries since last compaction. */
  getEntryCount(): number {
    return this.entryCount;
  }
}
