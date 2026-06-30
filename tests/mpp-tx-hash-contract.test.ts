import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Keypair so the module-level `Keypair.fromSecret(AGENT_SECRET_KEY)` in
// tools.ts doesn't throw on the test-only placeholder key (pre-existing issue).
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Keypair: {
      ...actual.Keypair,
      fromSecret: (_secret: string) => ({
        publicKey: () => 'MOCK_PUBLIC_KEY',
        sign: () => Buffer.alloc(64),
        secret: () => _secret,
      }),
    },
    Horizon: {
      Server: class {
        transactions() {
          return { transaction: () => ({ call: async () => ({ successful: true }) }) };
        }
        loadAccount() { return Promise.resolve({ balances: [] }); }
      },
    },
  };
});

import {
  payForMedication,
  setMppClient,
  resetSpendingTracker,
  setSpendingPolicy,
  setCurrentRecipient,
  getSpendingTracker,
} from '../agent/tools.ts';

const VALID_HASH = 'a'.repeat(64);

function makeMppClient(opts: {
  receiptHeader?: string | null;
  orderId?: string;
}) {
  return {
    fetch: async (_url: string, _init?: RequestInit) => {
      const headers = new Headers({ 'Content-Type': 'application/json' });
      if (opts.receiptHeader) {
        headers.set('Payment-Receipt', opts.receiptHeader);
      }
      const body = { success: true, order: { id: opts.orderId ?? `order-${Date.now()}` } };
      return new Response(JSON.stringify(body), { status: 200, headers });
    },
    get lastTxHash() { return undefined; },
  };
}

describe('payForMedication — stellarTxHash / mppOrderId contract (issue #20)', () => {
  const recipient = 'mpp-hash-test';
  let savedMockNetwork: string | undefined;

  beforeEach(() => {
    // Use real MPP path so setMppClient has effect (mock path ignores it)
    savedMockNetwork = process.env.MOCK_NETWORK;
    process.env.MOCK_NETWORK = '0';

    setCurrentRecipient(recipient);
    resetSpendingTracker(recipient);
    setSpendingPolicy(recipient, {
      dailyLimit: 1000,
      monthlyLimit: 5000,
      medicationMonthlyBudget: 2000,
      billMonthlyBudget: 3000,
      approvalThreshold: 500,
      holdTimeSeconds: 0,
    });
  });

  afterEach(() => {
    process.env.MOCK_NETWORK = savedMockNetwork;
    resetSpendingTracker(recipient);
  });

  it('sets stellarTxHash to undefined and mppOrderId populated when MPP returns no hash', async () => {
    const orderId = `order-${Date.now()}`;
    setMppClient(makeMppClient({ receiptHeader: null, orderId }));

    const result = await payForMedication(
      'pharmacy-1', 'Test Pharmacy', 'Lisinopril', 10, true,
    );

    expect(result.success).toBe(true);
    const tx = (result as any).transaction;
    expect(tx.stellarTxHash).toBeUndefined();
    expect(tx.mppOrderId).toBe(orderId);
  });

  it('never stores an order-{timestamp} string in stellarTxHash', async () => {
    const orderId = `order-${Date.now()}`;
    setMppClient(makeMppClient({ receiptHeader: null, orderId }));

    const result = await payForMedication(
      'pharmacy-1', 'Test Pharmacy', 'Metformin', 15, true,
    );

    const tx = (result as any).transaction;
    // stellarTxHash must never be set to an order-{timestamp} string
    if (tx.stellarTxHash !== undefined) {
      expect(tx.stellarTxHash).not.toMatch(/^order-/);
    }
    expect(tx.mppOrderId).toBe(orderId);
  });

  it('stores a valid 64-char hex hash in stellarTxHash when MPP provides one', async () => {
    const orderId = `order-${Date.now()}`;
    const receiptPayload = Buffer.from(JSON.stringify({ reference: VALID_HASH })).toString('base64');
    setMppClient(makeMppClient({ receiptHeader: receiptPayload, orderId }));

    const result = await payForMedication(
      'pharmacy-1', 'Test Pharmacy', 'Atorvastatin', 20, true,
    );

    expect(result.success).toBe(true);
    const tx = (result as any).transaction;
    expect(tx.stellarTxHash).toBe(VALID_HASH);
    expect(tx.mppOrderId).toBe(orderId);
  });

  it('discards a non-hex receipt value and leaves stellarTxHash undefined', async () => {
    const orderId = `order-${Date.now()}`;
    const receiptPayload = Buffer.from(JSON.stringify({ reference: orderId })).toString('base64');
    setMppClient(makeMppClient({ receiptHeader: receiptPayload, orderId }));

    const result = await payForMedication(
      'pharmacy-1', 'Test Pharmacy', 'Amlodipine', 12, true,
    );

    const tx = (result as any).transaction;
    expect(tx.stellarTxHash).toBeUndefined();
    expect(tx.mppOrderId).toBe(orderId);
  });

  it('records mppOrderId in the spending tracker transaction', async () => {
    const orderId = `order-${Date.now()}`;
    setMppClient(makeMppClient({ receiptHeader: null, orderId }));

    await payForMedication('pharmacy-1', 'Test Pharmacy', 'Lisinopril', 8, true);

    const tracker = getSpendingTracker();
    const recorded = tracker.transactions.find((t: any) => t.mppOrderId === orderId);
    expect(recorded).toBeDefined();
    expect(recorded.stellarTxHash).toBeUndefined();
  });
});
