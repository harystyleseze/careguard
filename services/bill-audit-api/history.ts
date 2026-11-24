import { mkdirSync } from 'fs';
import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import path from 'path';
import { logger } from '../../shared/logger.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

/**
 * Provider Bill History Subsystem (#1217)
 *
 * Persists historical bill line items indexed by provider and CPT procedure code.
 * Cross-references new medical bills against past charges from the same facility
 * to catch creeping price increases.
 */

export interface ProviderChargeRecord {
  id: string;
  providerId: string;
  providerName: string;
  recipientId: string | null;
  cptCode: string;
  description: string | null;
  chargedAmount: number;
  dateOfService: string;
  createdAt: string;
}

export interface ProviderHistoryComparison {
  providerId: string;
  cptCode: string;
  priorBillsCount: number;
  historicalAverage: number;
  increasePercent: number;
  isMaterialIncrease: boolean;
  dateRange: {
    start: string;
    end: string;
  };
}

export function normalizeProviderId(provider: string): string {
  return provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function defaultDbPath(): string {
  if (process.env.PROVIDER_HISTORY_DB_PATH) {
    return path.resolve(process.cwd(), process.env.PROVIDER_HISTORY_DB_PATH);
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
  }
  return new URL('../../data/careguard.sqlite', import.meta.url).pathname;
}

export class ProviderBillHistoryStore {
  private readonly db: any;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? defaultDbPath();
    if (resolvedPath !== ':memory:') {
      mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new DatabaseSync(resolvedPath);
    this.migrate();
    this.seedBaselineHistory();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_bill_history (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        recipient_id TEXT,
        cpt_code TEXT NOT NULL,
        description TEXT,
        charged_amount REAL NOT NULL,
        date_of_service TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_history_lookup
        ON provider_bill_history (provider_id, cpt_code);
    `);
  }

  private seedBaselineHistory(): void {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM provider_bill_history')
      .get() as { count: number };
    if (row.count > 0) return;

    const baselineRecords: Array<{
      providerId: string;
      providerName: string;
      cptCode: string;
      description: string;
      chargedAmount: number;
      dateOfService: string;
    }> = [
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '99233',
        description: 'Hospital care, high complexity',
        chargedAmount: 180,
        dateOfService: '2025-11-10',
      },
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '99233',
        description: 'Hospital care, high complexity',
        chargedAmount: 185,
        dateOfService: '2026-01-15',
      },
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '80053',
        description: 'Comprehensive metabolic panel',
        chargedAmount: 75,
        dateOfService: '2025-11-10',
      },
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '85025',
        description: 'Complete blood count (CBC)',
        chargedAmount: 35,
        dateOfService: '2025-11-10',
      },
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '71046',
        description: 'Chest X-ray, 2 views',
        chargedAmount: 140,
        dateOfService: '2026-01-15',
      },
      {
        providerId: 'general-hospital',
        providerName: 'General Hospital',
        cptCode: '99215',
        description: 'Office visit, complex',
        chargedAmount: 280,
        dateOfService: '2025-11-10',
      },
    ];

    const insertStmt = this.db.prepare(`
      INSERT INTO provider_bill_history (id, provider_id, provider_name, recipient_id, cpt_code, description, charged_amount, date_of_service, created_at)
      VALUES (?, ?, ?, 'rosa_garcia', ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    for (const item of baselineRecords) {
      insertStmt.run(
        `pbh_${randomUUID().slice(0, 8)}`,
        item.providerId,
        item.providerName,
        item.cptCode,
        item.description,
        item.chargedAmount,
        item.dateOfService,
        now,
      );
    }

    logger.info('[bill-audit] seeded baseline provider bill history for General Hospital');
  }

  recordCharge(input: {
    providerId: string;
    providerName?: string;
    recipientId?: string;
    cptCode: string;
    description?: string;
    chargedAmount: number;
    dateOfService?: string;
  }): ProviderChargeRecord {
    const id = `pbh_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const normalizedPid = normalizeProviderId(input.providerId);
    const pName = input.providerName || input.providerId;
    const dos = input.dateOfService || new Date().toISOString().split('T')[0];
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO provider_bill_history (id, provider_id, provider_name, recipient_id, cpt_code, description, charged_amount, date_of_service, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      normalizedPid,
      pName,
      input.recipientId ?? null,
      input.cptCode,
      input.description ?? null,
      input.chargedAmount,
      dos,
      createdAt,
    );

    return {
      id,
      providerId: normalizedPid,
      providerName: pName,
      recipientId: input.recipientId ?? null,
      cptCode: input.cptCode,
      description: input.description ?? null,
      chargedAmount: input.chargedAmount,
      dateOfService: dos,
      createdAt,
    };
  }

  recordBillCharges(input: {
    providerId: string;
    providerName?: string;
    recipientId?: string;
    lineItems: Array<{
      cptCode: string;
      description?: string;
      chargedAmount: number;
    }>;
    dateOfService?: string;
  }): ProviderChargeRecord[] {
    return input.lineItems.map((item) =>
      this.recordCharge({
        providerId: input.providerId,
        providerName: input.providerName,
        recipientId: input.recipientId,
        cptCode: item.cptCode,
        description: item.description,
        chargedAmount: item.chargedAmount,
        dateOfService: input.dateOfService,
      })
    );
  }

  getHistoryForCpt(providerId: string, cptCode: string): ProviderChargeRecord[] {
    const normalizedPid = normalizeProviderId(providerId);
    const rows = this.db
      .prepare(`
        SELECT * FROM provider_bill_history
        WHERE provider_id = ? AND cpt_code = ?
        ORDER BY date_of_service ASC
      `)
      .all(normalizedPid, cptCode) as any[];

    return rows.map((r) => ({
      id: r.id,
      providerId: r.provider_id,
      providerName: r.provider_name,
      recipientId: r.recipient_id,
      cptCode: r.cpt_code,
      description: r.description,
      chargedAmount: Number(r.charged_amount),
      dateOfService: r.date_of_service,
      createdAt: r.created_at,
    }));
  }

  /**
   * Compares a candidate charge against past billing by the same provider.
   *
   * Time Complexity: O(log N + K) indexed lookup for K past charges.
   * Space Complexity: O(K) records retrieved.
   *
   * @param providerId - Normalized or raw provider identifier
   * @param cptCode - Procedure code
   * @param chargedAmount - Candidate charged amount
   * @param threshold - Proportional increase threshold (default: 0.15 for 15%)
   * @returns Comparison result, or null if no prior history exists (graceful fallback)
   */
  compareAgainstHistory(
    paramsOrProviderId:
      | string
      | {
          providerId: string;
          cptCode: string;
          currentChargedAmount: number;
          threshold?: number;
          providerName?: string;
        },
    cptCode?: string,
    chargedAmount?: number,
    threshold = 0.15,
  ): ProviderHistoryComparison | null {
    let providerId: string;
    let code: string;
    let amt: number;
    let thresh: number;

    if (typeof paramsOrProviderId === 'object') {
      providerId = paramsOrProviderId.providerId;
      code = paramsOrProviderId.cptCode;
      amt = paramsOrProviderId.currentChargedAmount;
      thresh = paramsOrProviderId.threshold ?? 0.15;
    } else {
      providerId = paramsOrProviderId;
      code = cptCode!;
      amt = chargedAmount!;
      thresh = threshold;
    }

    const history = this.getHistoryForCpt(providerId, code);
    if (!history || history.length === 0) {
      return null; // Graceful fallback: no false positives when no history exists
    }

    const priorBillsCount = history.length;
    const totalPrior = history.reduce((sum, h) => sum + h.chargedAmount, 0);
    const historicalAverage = +(totalPrior / priorBillsCount).toFixed(2);

    const dates = history.map((h) => h.dateOfService).sort();
    const dateRange = {
      start: dates[0],
      end: dates[dates.length - 1],
    };

    const diff = amt - historicalAverage;
    const increasePercent = +((diff / historicalAverage) * 100).toFixed(1);
    const isMaterialIncrease = amt > historicalAverage * (1 + thresh);

    return {
      providerId: normalizeProviderId(providerId),
      cptCode: code,
      priorBillsCount,
      historicalAverage,
      increasePercent,
      isMaterialIncrease,
      dateRange,
    };
  }
}

let sharedHistoryStore: ProviderBillHistoryStore | undefined;

export function getProviderBillHistoryStore(dbPath?: string): ProviderBillHistoryStore {
  sharedHistoryStore ??= new ProviderBillHistoryStore(dbPath);
  return sharedHistoryStore;
}
