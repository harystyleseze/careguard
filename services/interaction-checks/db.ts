import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import path from 'path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Persisted history of drug interaction checks per care recipient (#1193),
 * so a caregiver can answer "have we checked X with Y before?" later.
 */
export interface InteractionCheckEntity {
  id: string;
  recipient_id: string;
  /** Medications as submitted to the check, in order. */
  medications: string[];
  /** Number of interactions found. */
  interaction_count: number;
  /** Highest severity found, or null when none. */
  highest_severity: string | null;
  summary: string | null;
  /** Full interaction results returned by the check. */
  interactions: unknown[];
  checked_at: string;
}

export type InteractionCheckInput = Omit<InteractionCheckEntity, 'id'>;

/** Default retention: entries older than this are pruned on write. */
export const DEFAULT_RETENTION_DAYS = 365;

const SEVERITY_RANK = ['minor', 'moderate', 'major', 'severe', 'contraindicated'];

export function retentionDays(): number {
  const raw = Number(process.env.INTERACTION_CHECK_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

function defaultDbPath(): string {
  if (process.env.INTERACTION_CHECKS_DB_PATH) {
    return path.resolve(process.cwd(), process.env.INTERACTION_CHECKS_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return new URL('../../data/careguard.sqlite', import.meta.url).pathname;
}

/** Lowercased, pipe-delimited copy of the drug names for case-insensitive filtering. */
function searchKey(medications: string[]): string {
  return `|${medications.map((m) => m.trim().toLowerCase()).join('|')}|`;
}

/** Extracts count / highest severity / summary from a check result of any shape. */
export function summarizeResult(result: unknown): Pick<InteractionCheckInput, 'interaction_count' | 'highest_severity' | 'summary' | 'interactions'> {
  const r = (result ?? {}) as { interactions?: unknown; summary?: unknown };
  const interactions = Array.isArray(r.interactions) ? r.interactions : [];
  let highest: string | null = null;
  for (const i of interactions) {
    const sev = typeof (i as { severity?: unknown })?.severity === 'string' ? (i as { severity: string }).severity.toLowerCase() : null;
    if (sev && (highest === null || SEVERITY_RANK.indexOf(sev) > SEVERITY_RANK.indexOf(highest))) highest = sev;
  }
  return {
    interaction_count: interactions.length,
    highest_severity: highest,
    summary: typeof r.summary === 'string' ? r.summary : null,
    interactions,
  };
}

export class InteractionCheckStore {
  private readonly db: any;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? defaultDbPath();
    if (resolvedPath !== ':memory:') {
      mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS interaction_checks (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        medications TEXT NOT NULL,
        medications_search TEXT NOT NULL,
        interaction_count INTEGER NOT NULL,
        highest_severity TEXT,
        summary TEXT,
        result TEXT NOT NULL,
        checked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS interaction_checks_recipient_time
        ON interaction_checks (recipient_id, checked_at);
    `);
  }

  /** Newest first. `drug` matches any checked medication (case-insensitive substring). */
  list(recipientId: string, opts: { drug?: string; limit?: number } = {}): InteractionCheckEntity[] {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const drug = opts.drug?.trim().toLowerCase();
    const rows = drug
      ? this.db
          .prepare(
            `SELECT * FROM interaction_checks
             WHERE recipient_id = ? AND medications_search LIKE ? ESCAPE '\\'
             ORDER BY checked_at DESC LIMIT ?`,
          )
          .all(recipientId, `%${drug.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit)
      : this.db
          .prepare('SELECT * FROM interaction_checks WHERE recipient_id = ? ORDER BY checked_at DESC LIMIT ?')
          .all(recipientId, limit);
    return (rows as any[]).map((row) => ({
      id: row.id,
      recipient_id: row.recipient_id,
      medications: JSON.parse(row.medications),
      interaction_count: Number(row.interaction_count),
      highest_severity: row.highest_severity ?? null,
      summary: row.summary ?? null,
      interactions: JSON.parse(row.result),
      checked_at: row.checked_at,
    }));
  }

  record(input: InteractionCheckInput, now = new Date()): InteractionCheckEntity {
    const id = `ixcheck_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO interaction_checks
        (id, recipient_id, medications, medications_search, interaction_count, highest_severity, summary, result, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.recipient_id,
      JSON.stringify(input.medications),
      searchKey(input.medications),
      input.interaction_count,
      input.highest_severity,
      input.summary,
      JSON.stringify(input.interactions),
      input.checked_at,
    );
    this.prune(now);
    return { id, ...input };
  }

  /** Deletes entries older than the retention window. Returns rows removed. */
  prune(now = new Date(), days = retentionDays()): number {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM interaction_checks WHERE checked_at < ?').run(cutoff);
    return Number(result.changes);
  }
}

let shared: InteractionCheckStore | null = null;

/**
 * Process-wide store: the agent runner writes and the /agent routes read the
 * same instance (matters for the in-memory test DB).
 */
export function getInteractionCheckStore(): InteractionCheckStore {
  shared ??= new InteractionCheckStore();
  return shared;
}

/** Records a completed check. Skips failed/invalid results; never throws. */
export function recordInteractionCheck(
  recipientId: string,
  medications: string[],
  result: unknown,
  store: InteractionCheckStore = getInteractionCheckStore(),
): InteractionCheckEntity | null {
  try {
    if (!result || (result as { ok?: unknown }).ok === false) return null;
    return store.record({
      recipient_id: recipientId,
      medications,
      checked_at: typeof (result as { checkTimestamp?: unknown }).checkTimestamp === 'string'
        ? (result as { checkTimestamp: string }).checkTimestamp
        : new Date().toISOString(),
      ...summarizeResult(result),
    });
  } catch {
    return null;
  }
}
