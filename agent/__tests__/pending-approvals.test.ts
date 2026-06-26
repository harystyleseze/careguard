// Tests for pending approvals: cancel, approve, and auto-approve

// vi.hoisted runs before any vi.mock factory
const { mockMppFetch, onProgressHolder } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = 'SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD';
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return { mockMppFetch: vi.fn(), onProgressHolder };
});

vi.mock('dotenv/config', () => ({}));
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GPUB123', sign: vi.fn() }) },
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  TransactionBuilder: vi.fn().mockReturnValue({ addOperation: vi.fn().mockReturnThis(), setTimeout: vi.fn().mockReturnThis(), build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [{ hint: vi.fn() }] }) }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn() }) },
}));
vi.mock('@x402/stellar', () => ({ createEd25519Signer: vi.fn().mockReturnValue({}), ExactStellarScheme: vi.fn() }));
vi.mock('@x402/fetch', () => ({ wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()), x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }), decodePaymentResponseHeader: vi.fn() }));
vi.mock('@stellar/mpp/charge/client', () => ({ stellar: vi.fn().mockImplementation((opts: any) => { if (opts?.onProgress) onProgressHolder.fn = opts.onProgress; return {}; }) }));
vi.mock('mppx/client', () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: mockMppFetch }) } }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  payForMedication,
  setSpendingPolicy,
  resetSpendingTracker,
  cancelPendingTransaction,
  approvePendingTransaction,
  processPendingTransactions,
  getSpendingTracker,
} from '../tools.ts';

const DEFAULT_POLICY = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

beforeEach(() => {
  mockMppFetch.mockReset();
  resetSpendingTracker();
  setSpendingPolicy({ ...DEFAULT_POLICY });
});

describe('Pending approvals flows', () => {
  it('hold + cancel', async () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, holdTimeSeconds: 60 });
    const r = await payForMedication('p1', 'Pharma', 'Drug', 80);
    expect(r.success).toBe(false);
    const tx = (r as any).transaction;
    expect(tx).toBeDefined();
    expect(tx.status).toBe('pending');

    const cancelled = cancelPendingTransaction(tx.id);
    expect(cancelled.success).toBe(true);
    expect(cancelled.transaction.status).toBe('cancelled');

    const tracker = getSpendingTracker();
    const found = tracker.transactions.find((t: any) => t.id === tx.id);
    expect(found.status).toBe('cancelled');
  });

  it('hold + approve', async () => {
    setSpendingPolicy({ ...DEFAULT_POLICY, holdTimeSeconds: 60 });
    // Ensure MPP will succeed when approving
    mockMppFetch.mockResolvedValueOnce({ json: async () => ({ success: true, order: { id: 'o-1' } }), headers: { get: () => null } });

    const r = await payForMedication('p1', 'Pharma', 'Drug', 80);
    expect(r.success).toBe(false);
    const tx = (r as any).transaction;
    const res = await approvePendingTransaction(tx.id);
    expect(res.success).toBe(true);
    expect(res.transaction.status).toBe('completed');

    const tracker = getSpendingTracker();
    const found = tracker.transactions.find((t: any) => t.id === tx.id);
    expect(found.status).toBe('completed');
  });

  it('hold + auto-approve', async () => {
    // immediate auto-approve
    setSpendingPolicy({ ...DEFAULT_POLICY, holdTimeSeconds: 0 });
    mockMppFetch.mockResolvedValueOnce({ json: async () => ({ success: true, order: { id: 'o-2' } }), headers: { get: () => null } });

    const r = await payForMedication('p1', 'Pharma', 'Drug', 80);
    expect(r.success).toBe(false);
    const tx = (r as any).transaction;
    // process pending should pick this up immediately
    await processPendingTransactions();

    const tracker = getSpendingTracker();
    const found = tracker.transactions.find((t: any) => t.id === tx.id);
    expect(found.status).toBe('completed');
  });
});
