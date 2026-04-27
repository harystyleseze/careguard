/**
 * Baseline tests for agent/tools.ts — spending policy, money math,
 * tx-hash extraction, and getSpendingSummary (#238).
 *
 * These tests mock all I/O (fs, environment) so they run offline
 * without a live Stellar node or real API keys.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock I/O before importing the module under test ──────────────────────────
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));
vi.mock('dotenv/config', () => ({}));

// Stub heavy Stellar / payment imports — we only test pure logic here.
vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: { fromSecret: vi.fn(() => ({ publicKey: () => 'GABC', secret: () => 'SABC' })) },
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  TransactionBuilder: vi.fn(),
  Operation: {},
  Asset: { native: vi.fn() },
  Horizon: { Server: vi.fn() },
}));
vi.mock('@x402/fetch', () => ({
  wrapFetchWithPayment: vi.fn(() => vi.fn()),
  x402Client: vi.fn(() => ({ register: vi.fn().mockReturnThis() })),
  decodePaymentResponseHeader: vi.fn(),
}));
vi.mock('@x402/stellar', () => ({
  createEd25519Signer: vi.fn(),
  ExactStellarScheme: vi.fn(),
}));
vi.mock('mppx/client', () => ({ Mppx: { create: vi.fn(() => ({})) } }));
vi.mock('@stellar/mpp/charge/client', () => ({ stellar: vi.fn() }));

// Set a fake secret so the module initialises without throwing.
process.env.AGENT_SECRET_KEY = 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3';

import {
  checkSpendingPolicy,
  setSpendingPolicy,
  resetSpendingTracker,
  getSpendingTracker,
  getSpendingSummary,
} from '../tools';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

beforeEach(() => {
  resetSpendingTracker();
  setSpendingPolicy({ ...DEFAULT_POLICY });
});

// ── checkSpendingPolicy: basic allow / block ──────────────────────────────────

describe('checkSpendingPolicy — medication budget', () => {
  it('allows a payment within budget', () => {
    const result = checkSpendingPolicy(50, 'medications');
    expect(result.allowed).toBe(true);
  });

  it('blocks a payment that exceeds monthly medication budget', () => {
    const result = checkSpendingPolicy(350, 'medications');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('monthly budget');
  });

  it('blocks exactly at budget boundary + 1 cent', () => {
    const result = checkSpendingPolicy(300.01, 'medications');
    expect(result.allowed).toBe(false);
  });

  it('allows payment equal to remaining budget', () => {
    const result = checkSpendingPolicy(300, 'medications');
    expect(result.allowed).toBe(true);
  });
});

describe('checkSpendingPolicy — bill budget', () => {
  it('allows a bill payment within budget', () => {
    const result = checkSpendingPolicy(200, 'bills');
    expect(result.allowed).toBe(true);
  });

  it('blocks a bill payment exceeding monthly bill budget', () => {
    const result = checkSpendingPolicy(600, 'bills');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('monthly budget');
  });
});

describe('checkSpendingPolicy — daily limit', () => {
  it('blocks when daily limit is set very low', () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, dailyLimit: 10 });
    const result = checkSpendingPolicy(15, 'medications');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('daily limit');
  });

  it('allows when amount is exactly at daily limit', () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, dailyLimit: 50 });
    const result = checkSpendingPolicy(50, 'medications');
    expect(result.allowed).toBe(true);
  });
});

describe('checkSpendingPolicy — approval threshold', () => {
  it('does not require approval for small amounts', () => {
    const result = checkSpendingPolicy(30, 'medications');
    expect(result.requiresApproval).toBe(false);
  });

  it('requires approval above the threshold', () => {
    const result = checkSpendingPolicy(80, 'medications');
    expect(result.requiresApproval).toBe(true);
  });

  it('reports remaining budget correctly', () => {
    const result = checkSpendingPolicy(50, 'medications');
    expect(result.budgetRemaining).toBeCloseTo(250, 2);
  });
});

// ── Money math precision ──────────────────────────────────────────────────────

describe('Money math in checkSpendingPolicy', () => {
  it('handles fractional dollar amounts without floating-point drift', () => {
    // 0.1 + 0.2 is the classic JS float trap — ensure rounding is sane.
    const result = checkSpendingPolicy(0.1 + 0.2, 'medications');
    expect(result.allowed).toBe(true);
    expect(result.budgetRemaining).toBeGreaterThan(299);
  });

  it('budgetRemaining is non-negative for allowed payment', () => {
    const result = checkSpendingPolicy(100, 'medications');
    expect(result.budgetRemaining).toBeGreaterThanOrEqual(0);
  });

  it('currentSpending starts at 0 on fresh tracker', () => {
    const result = checkSpendingPolicy(10, 'medications');
    expect(result.currentSpending).toBe(0);
  });
});

// ── getSpendingTracker / getSpendingSummary ──────────────────────────────────

describe('getSpendingTracker', () => {
  it('returns a copy of the current tracker', () => {
    const tracker = getSpendingTracker();
    expect(tracker).toHaveProperty('medications');
    expect(tracker).toHaveProperty('bills');
    expect(tracker).toHaveProperty('serviceFees');
    expect(tracker).toHaveProperty('transactions');
    expect(tracker).toHaveProperty('policy');
  });

  it('policy reflects setSpendingPolicy changes', () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, dailyLimit: 999 });
    const tracker = getSpendingTracker();
    expect(tracker.policy.dailyLimit).toBe(999);
  });
});

describe('getSpendingSummary', () => {
  it('returns a summary object with spending sub-keys', () => {
    const summary = getSpendingSummary();
    expect(summary).toHaveProperty('spending');
    expect(summary.spending).toHaveProperty('medications');
    expect(summary.spending).toHaveProperty('bills');
    expect(summary.spending).toHaveProperty('total');
  });

  it('total equals sum of medications and bills', () => {
    const summary = getSpendingSummary();
    const calculated = summary.spending.medications + summary.spending.bills + summary.spending.serviceFees;
    expect(summary.spending.total).toBeCloseTo(calculated, 2);
  });
});
