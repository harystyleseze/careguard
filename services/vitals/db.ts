import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import path from 'path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Manually logged vitals (#1237). Kept to a small fixed set so the dashboard
 * can chart them without free-form unit handling.
 */
export const VITAL_TYPES = ['weight', 'blood_pressure', 'glucose'] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

/** Accepted units per vital type; the first entry is the default. */
export const VITAL_UNITS: Record<VitalType, readonly string[]> = {
  weight: ['lb', 'kg'],
  blood_pressure: ['mmHg'],
  glucose: ['mg/dL', 'mmol/L'],
};

export interface VitalEntity {
  id: string;
  recipient_id: string;
  type: VitalType;
  /** Systolic for blood pressure; the reading itself for other types. */
  value: number;
  /** Diastolic for blood pressure; null for other types. */
  secondary_value: number | null;
  unit: string;
  timestamp: string;
}

export type VitalInput = Omit<VitalEntity, 'id'>;

function defaultDbPath(): string {
  if (process.env.VITALS_DB_PATH) {
    return path.resolve(process.cwd(), process.env.VITALS_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return new URL('../../data/careguard.sqlite', import.meta.url).pathname;
}

export function isVitalType(type: unknown): type is VitalType {
  return typeof type === 'string' && (VITAL_TYPES as readonly string[]).includes(type);
}

export class VitalsStore {
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
      CREATE TABLE IF NOT EXISTS vitals (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        secondary_value REAL,
        unit TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS vitals_recipient_time
        ON vitals (recipient_id, timestamp);
    `);
  }

  list(recipientId: string, type?: VitalType): VitalEntity[] {
    const rows = type
      ? this.db
          .prepare('SELECT * FROM vitals WHERE recipient_id = ? AND type = ? ORDER BY timestamp ASC')
          .all(recipientId, type)
      : this.db
          .prepare('SELECT * FROM vitals WHERE recipient_id = ? ORDER BY timestamp ASC')
          .all(recipientId);
    return (rows as VitalEntity[]).map((row) => ({
      ...row,
      secondary_value: row.secondary_value ?? null,
    }));
  }

  create(input: VitalInput): VitalEntity {
    const id = `vital_${Date.now()}_${randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO vitals (id, recipient_id, type, value, secondary_value, unit, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.recipient_id,
      input.type,
      input.value,
      input.secondary_value ?? null,
      input.unit,
      input.timestamp,
    );
    return { id, ...input, secondary_value: input.secondary_value ?? null };
  }

  delete(recipientId: string, id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM vitals WHERE id = ? AND recipient_id = ?')
      .run(id, recipientId);
    return Number(result.changes) > 0;
  }
}

export function createVitalsStore(dbPath?: string): VitalsStore {
  return new VitalsStore(dbPath);
}
