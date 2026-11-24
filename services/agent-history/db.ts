import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import path from 'path';
import { redact, redactPII } from '../../shared/redact.ts';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Persisted, searchable history of agent tool invocations per care recipient,
 * so a caregiver can recall why a specific payment or audit happened.
 *
 * Secrets (Stellar seeds, bearer tokens, secret-named fields) are stripped via
 * `redact()` before anything is written; PII is additionally stripped via
 * `redactPII()` before an entry is returned for display.
 */

export type AgentHistoryStatus = 'success' | 'error' | 'blocked' | 'pending';

/** A record the invocation produced that the dashboard can link through to. */
export interface AgentHistoryLink {
  kind: 'transaction' | 'dispute' | 'bill_audit' | 'interaction_check' | 'approval';
  id?: string;
  label: string;
  /** Present for on-chain transactions; the dashboard links to the explorer. */
  stellarTxHash?: string;
}

export interface AgentHistoryEntry {
  id: string;
  recipient_id: string;
  run_id: string | null;
  /** The caregiver's request that triggered the run. */
  task: string | null;
  tool: string;
  input: Record<string, unknown>;
  status: AgentHistoryStatus;
  /** One-line, human-readable outcome. */
  summary: string;
  error: string | null;
  links: AgentHistoryLink[];
  created_at: string;
}

export type AgentHistoryInput = Omit<AgentHistoryEntry, 'id'>;

export interface AgentHistoryQuery {
  /** Case-insensitive substring match on the tool name. */
  tool?: string;
  /** Inclusive ISO date/time lower bound. */
  from?: string;
  /** Inclusive ISO date/time upper bound; a bare date covers the whole day. */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AgentHistoryPage {
  entries: AgentHistoryEntry[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean; hasPrevious: boolean };
}

export const DEFAULT_HISTORY_LIMIT = 25;
export const MAX_HISTORY_LIMIT = 200;
/** Default retention: entries older than this are pruned on write. */
export const DEFAULT_RETENTION_DAYS = 365;

export function retentionDays(): number {
  const raw = Number(process.env.AGENT_HISTORY_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

function defaultDbPath(): string {
  if (process.env.AGENT_HISTORY_DB_PATH) {
    return path.resolve(process.cwd(), process.env.AGENT_HISTORY_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return new URL('../../data/careguard.sqlite', import.meta.url).pathname;
}

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoBound(raw: string | undefined, end: boolean): string | null {
  if (!raw) return null;
  const value = BARE_DATE_RE.test(raw) ? `${raw}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : raw;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

/** Strips PII from free text before display; secrets were removed on write. */
function redactForDisplay<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return redactPII(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactForDisplay(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactForDisplay(v, depth + 1);
    return out as unknown as T;
  }
  return value;
}

export class AgentHistoryStore {
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
      CREATE TABLE IF NOT EXISTS agent_tool_history (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        run_id TEXT,
        task TEXT,
        tool TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        error TEXT,
        links TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_tool_history_recipient_time
        ON agent_tool_history (recipient_id, created_at);
    `);
  }

  /** Newest first, paginated, PII-redacted for display. */
  list(recipientId: string, opts: AgentHistoryQuery = {}): AgentHistoryPage {
    const limit = clampInt(opts.limit, DEFAULT_HISTORY_LIMIT, 1, MAX_HISTORY_LIMIT);
    const offset = clampInt(opts.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const where = ['recipient_id = ?'];
    const params: unknown[] = [recipientId];

    const tool = opts.tool?.trim().toLowerCase();
    if (tool) {
      where.push("LOWER(tool) LIKE ? ESCAPE '\\'");
      params.push(`%${tool.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const from = toIsoBound(opts.from, false);
    if (from) {
      where.push('created_at >= ?');
      params.push(from);
    }
    const to = toIsoBound(opts.to, true);
    if (to) {
      where.push('created_at <= ?');
      params.push(to);
    }

    const clause = where.join(' AND ');
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM agent_tool_history WHERE ${clause}`).get(...params).n,
    );
    const rows = this.db
      .prepare(`SELECT * FROM agent_tool_history WHERE ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return {
      entries: rows.map((row) =>
        redactForDisplay<AgentHistoryEntry>({
          id: row.id,
          recipient_id: row.recipient_id,
          run_id: row.run_id ?? null,
          task: row.task ?? null,
          tool: row.tool,
          input: JSON.parse(row.input),
          status: row.status,
          summary: row.summary,
          error: row.error ?? null,
          links: JSON.parse(row.links),
          created_at: row.created_at,
        }),
      ),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
        hasPrevious: offset > 0,
      },
    };
  }

  /** Distinct tool names recorded for a recipient, for the filter dropdown. */
  tools(recipientId: string): string[] {
    return (
      this.db
        .prepare('SELECT DISTINCT tool FROM agent_tool_history WHERE recipient_id = ? ORDER BY tool')
        .all(recipientId) as any[]
    ).map((r) => r.tool);
  }

  record(input: AgentHistoryInput, now = new Date()): AgentHistoryEntry {
    const id = `agenthist_${Date.now()}_${randomUUID().slice(0, 8)}`;
    // Secrets never reach disk. `task` is a secret-named field for redact(),
    // so keep the caregiver's request but strip any secrets embedded in it.
    const safe = { ...redact(input), task: input.task == null ? null : redact({ text: input.task }).text };
    this.db.prepare(`
      INSERT INTO agent_tool_history
        (id, recipient_id, run_id, task, tool, input, status, summary, error, links, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      safe.recipient_id,
      safe.run_id,
      safe.task,
      safe.tool,
      JSON.stringify(safe.input ?? {}),
      safe.status,
      safe.summary,
      safe.error,
      JSON.stringify(safe.links ?? []),
      safe.created_at,
    );
    this.prune(now);
    return { id, ...safe };
  }

  /** Deletes entries older than the retention window. Returns rows removed. */
  prune(now = new Date(), days = retentionDays()): number {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare('DELETE FROM agent_tool_history WHERE created_at < ?').run(cutoff);
    return Number(result.changes);
  }
}

let shared: AgentHistoryStore | null = null;

/**
 * Process-wide store: the agent runner writes and the /agent routes read the
 * same instance (matters for the in-memory test DB).
 */
export function getAgentHistoryStore(): AgentHistoryStore {
  shared ??= new AgentHistoryStore();
  return shared;
}

// ── Outcome extraction ─────────────────────────────────────────────────────

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}` : '';
}

/** Derives status, a one-line summary and link targets from a tool result of any shape. */
export function describeOutcome(
  tool: string,
  result: unknown,
): Pick<AgentHistoryInput, 'status' | 'summary' | 'error' | 'links'> {
  const r = (result ?? {}) as Record<string, any>;
  const links: AgentHistoryLink[] = [];

  const tx = r.transaction as Record<string, any> | undefined;
  if (tx && str(tx.id)) {
    links.push({
      kind: tx.status === 'pending' ? 'approval' : 'transaction',
      id: tx.id,
      label: [str(tx.description), money(tx.amount)].filter(Boolean).join(' · ') || tx.id,
      ...(str(tx.stellarTxHash) ? { stellarTxHash: tx.stellarTxHash } : {}),
    });
  }
  const dispute = r.disputeRecord as Record<string, any> | undefined;
  if (dispute && str(dispute.id)) {
    links.push({ kind: 'dispute', id: dispute.id, label: `Dispute letter for bill ${dispute.billId ?? ''}`.trim() });
  }
  if ((tool === 'audit_medical_bill' || tool === 'fetch_and_audit_bill') && r.errorCount !== undefined) {
    links.push({ kind: 'bill_audit', id: str(r.billId), label: 'Bill audit' });
  }
  if (tool === 'check_drug_interactions' && Array.isArray(r.interactions)) {
    links.push({ kind: 'interaction_check', label: 'Interaction check' });
  }

  const errorText = str(r.error) ?? (r.ok === false ? str(r.message) ?? str(r.reason) : undefined);
  let status: AgentHistoryStatus = 'success';
  if (tx?.status === 'pending' || r.status === 'pending') status = 'pending';
  else if (tx?.status === 'blocked' || r.status === 'blocked') status = 'blocked';
  else if (errorText || r.ok === false || r.success === false) status = 'error';

  let summary: string;
  if (status === 'error') summary = `Failed: ${errorText ?? 'unknown error'}`;
  else if (tx) summary = `${status === 'success' ? 'Paid' : status === 'pending' ? 'Awaiting approval for' : 'Blocked'} ${money(tx.amount)} — ${tx.description ?? ''}`.trim();
  else if (dispute) summary = `Generated dispute letter (${money(dispute.totalOvercharge)} overcharge)`;
  else if (r.errorCount !== undefined && r.totalOvercharge !== undefined)
    summary = `Audit found ${r.errorCount} error${r.errorCount === 1 ? '' : 's'}, ${money(r.totalOvercharge)} overcharge`;
  else if (r.cheapest?.pharmacyName) summary = `Cheapest: ${r.cheapest.pharmacyName} at ${money(r.cheapest.price)}`;
  else if (str(r.summary)) summary = r.summary;
  else summary = 'Completed';

  return { status, summary: summary.slice(0, 300), error: status === 'error' ? errorText ?? null : null, links };
}

/** Records a tool invocation from the agent runner. Never throws. */
export function recordAgentToolCall(
  args: {
    recipientId: string;
    runId?: string | null;
    task?: string | null;
    tool: string;
    input: Record<string, unknown>;
    result: unknown;
    at?: string;
  },
  store?: AgentHistoryStore,
): AgentHistoryEntry | null {
  try {
    return (store ?? getAgentHistoryStore()).record({
      recipient_id: args.recipientId,
      run_id: args.runId ?? null,
      task: args.task ?? null,
      tool: args.tool,
      input: args.input ?? {},
      created_at: args.at ?? new Date().toISOString(),
      ...describeOutcome(args.tool, args.result),
    });
  } catch {
    return null;
  }
}
