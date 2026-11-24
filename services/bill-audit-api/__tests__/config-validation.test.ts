import { describe, it, expect, vi, beforeEach } from 'vitest';

let allowlistJson: string | null = null;
let thresholdsJson: string | null = null;

vi.hoisted(() => {
  process.env.BILL_PROVIDER_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER = '1.5';
  process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER = '1.2';
  process.env.BILL_AUDIT_UPCODED_MULTIPLIER = '3.0';
});

const errorCalls: { msg: string; ctx: any }[] = [];
vi.mock('../../../shared/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((_ctx: any, msg: string) => {
      errorCalls.push({ msg, ctx: _ctx });
    }),
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: (path: any, enc?: any) => {
      const p = String(path);
      if (p.includes('duplicates-allowlist.json')) {
        return allowlistJson === null ? actual.readFileSync(p, enc) : allowlistJson;
      }
      if (p.includes('audit_thresholds.json')) {
        return thresholdsJson === null ? actual.readFileSync(p, enc) : thresholdsJson;
      }
      return actual.readFileSync(p, enc);
    },
  };
});

beforeEach(() => {
  allowlistJson = null;
  thresholdsJson = null;
  errorCalls.length = 0;
});

import {
  loadAuditThresholds,
  loadDuplicateAllowlist,
  thresholdsLoaded,
  allowlistLoaded,
} from '../server.ts';

const MALFORMED_ALLOWLIST = 'not json';
const MALFORMED_THRESHOLDS = '{"default": "not-a-number", "byCpt": {}}';
const MISSING_DEFAULT_THRESHOLDS = '{"byCpt": {"97110": 2.0}}';

function lastSchemaError() {
  return errorCalls.find((c) => c.msg.includes('failed schema validation'));
}

describe('config schema validation (Issue #918)', () => {
  it('rejects malformed duplicates-allowlist.json with a clear diagnostic', () => {
    allowlistJson = MALFORMED_ALLOWLIST;
    loadDuplicateAllowlist();
    expect(allowlistLoaded).toBe(false);
    const err = lastSchemaError();
    expect(err).toBeDefined();
    expect(err.ctx.issues).toBeDefined();
  });

  it('rejects allowlist entries missing required keys', () => {
    allowlistJson = JSON.stringify([{ code: '96372' }]);
    loadDuplicateAllowlist();
    expect(allowlistLoaded).toBe(false);
    const err = lastSchemaError();
    expect(err).toBeDefined();
    expect(String(err.ctx.issues)).toContain('reason');
  });

  it('rejects audit_thresholds.json with wrong types', () => {
    thresholdsJson = MALFORMED_THRESHOLDS;
    loadAuditThresholds();
    expect(thresholdsLoaded).toBe(false);
    const err = lastSchemaError();
    expect(err).toBeDefined();
    expect(String(err.ctx.issues)).toContain('default');
  });

  it('rejects audit_thresholds.json missing required keys', () => {
    thresholdsJson = MISSING_DEFAULT_THRESHOLDS;
    loadAuditThresholds();
    expect(thresholdsLoaded).toBe(false);
    const err = lastSchemaError();
    expect(err).toBeDefined();
  });

  it('loads valid files exactly as before', () => {
    allowlistJson = JSON.stringify([
      { code: '96372', reason: 'r', addedBy: 'a', addedAt: '2026-01-01' },
    ]);
    thresholdsJson = JSON.stringify({ default: 1.5, byCpt: { '97110': 2.0 } });
    loadDuplicateAllowlist();
    loadAuditThresholds();
    expect(allowlistLoaded).toBe(true);
    expect(thresholdsLoaded).toBe(true);
  });
});
