import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  checkSpendingPolicy,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  getPharmacyPrices,
  fetchRosaBill,
} from './tools';
import { TRANSACTION_CATEGORY } from '../shared/types';
import * as x402fetch from '@x402/fetch';

// Mock getLocalDayBounds from tz.ts so we can control time boundaries
import * as tz from './tz';
vi.mock('./tz', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tz')>();
  return {
    ...actual,
    getLocalDayBounds: vi.fn(),
  };
});

// Mock network responses
vi.mock('@x402/fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@x402/fetch')>();
  return {
    ...actual,
    getX402Fetch: vi.fn(),
    extractX402TxHash: vi.fn(() => 'mock-hash'),
  };
});

describe('Spending Policy Engine', () => {
  beforeEach(() => {
    resetSpendingTracker('test-recipient');
    vi.clearAllMocks();
    
    // Default day bounds (e.g. 2026-01-01)
    vi.mocked(tz.getLocalDayBounds).mockReturnValue({
      dayStart: new Date('2026-01-01T00:00:00.000Z'),
      dayEnd: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('allows payment when budget is available', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 200,
      billMonthlyBudget: 800,
      dailyLimit: 100,
      approvalThreshold: 50,
    });
    const tracker = getSpendingTracker('test-recipient');
    tracker.medications = 50;

    const result = checkSpendingPolicy(30, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('rejects payment if monthly budget is exceeded', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 100,
      billMonthlyBudget: 900,
      dailyLimit: 100,
      approvalThreshold: 50,
    });
    const tracker = getSpendingTracker('test-recipient');
    tracker.medications = 80;

    const result = checkSpendingPolicy(30, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds medication monthly budget');
  });

  it('rejects payment if daily spending limit is exceeded', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 500,
      dailyLimit: 100,
      approvalThreshold: 200, // High threshold
    });
    const tracker = getSpendingTracker('test-recipient');
    tracker.medications = 0;
    
    // Add a transaction today for 80
    tracker.transactions.push({
      id: 'tx-1',
      timestamp: '2026-01-01T12:00:00.000Z',
      amount: 80,
      category: TRANSACTION_CATEGORY.MEDICATIONS,
    });

    const result = checkSpendingPolicy(30, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceed daily limit');
  });

  it('requires approval if payment exceeds approval threshold', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 500,
      dailyLimit: 200,
      approvalThreshold: 50,
    });

    const result = checkSpendingPolicy(60, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it('handles local timezone daily-boundary correctly', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 500,
      billMonthlyBudget: 500,
      dailyLimit: 100,
      approvalThreshold: 50,
      timezone: 'America/New_York',
    });
    
    // Mock the bounds to represent a specific day in NY
    vi.mocked(tz.getLocalDayBounds).mockReturnValue({
      dayStart: new Date('2026-01-01T05:00:00.000Z'), // Midnight NY is 5am UTC
      dayEnd: new Date('2026-01-02T05:00:00.000Z'),
    });

    const tracker = getSpendingTracker('test-recipient');
    
    // Transaction just BEFORE the day started in NY (yesterday)
    tracker.transactions.push({
      id: 'tx-1',
      timestamp: '2026-01-01T04:59:59.000Z',
      amount: 90,
      category: TRANSACTION_CATEGORY.MEDICATIONS,
    });

    // Should be allowed because today's spend is 0
    const result1 = checkSpendingPolicy(30, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result1.allowed).toBe(true);
    
    // Add a transaction today
    tracker.transactions.push({
      id: 'tx-2',
      timestamp: '2026-01-01T10:00:00.000Z',
      amount: 80,
      category: TRANSACTION_CATEGORY.MEDICATIONS,
    });
    
    // Should be rejected because today's spend is 80, and 80 + 30 > 100
    const result2 = checkSpendingPolicy(30, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result2.allowed).toBe(false);
  });

  it('isolates budgets between categories', () => {
    setSpendingPolicy('test-recipient', {
      monthlyLimit: 1000,
      medicationMonthlyBudget: 100,
      billMonthlyBudget: 900,
      dailyLimit: 1000,
      approvalThreshold: 500,
    });
    
    const tracker = getSpendingTracker('test-recipient');
    // Spent 900 on bills
    tracker.bills = 900;
    
    // Medication should still be allowed up to 100
    const result = checkSpendingPolicy(50, TRANSACTION_CATEGORY.MEDICATIONS);
    expect(result.allowed).toBe(true);
  });
});

describe('Safe JSON Parsing (Issue #161)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Disable mock network to trigger fetch code paths
    delete process.env.MOCK_NETWORK;
  });

  afterEach(() => {
    process.env.MOCK_NETWORK = '1';
  });

  it('handles malformed JSON from pharmacy API gracefully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'payment-response': 'mock-hash' }),
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    });
    vi.mocked(x402fetch.getX402Fetch).mockReturnValue(mockFetch);

    const result = await getPharmacyPrices('Lisinopril');
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_RESPONSE' });
  });

  it('handles malformed JSON from bill API gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    });

    const result = await fetchRosaBill('test-recipient');
    expect(result).toEqual({ ok: false, reason: 'MALFORMED_RESPONSE' });
  });
});
