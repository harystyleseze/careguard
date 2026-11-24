import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Test suite for concurrent order saving with file locking (Issue #929).
 * Tests the real saveOrder/loadOrders persistence and locking logic from server.ts
 * rather than local duplicates.
 */

const TEST_DATA_DIR = path.resolve('./test-data-concurrent');
const TEST_ORDERS_FILE = path.join(TEST_DATA_DIR, 'orders.json');

// Configure required env vars before importing server.ts
process.env.PHARMACY_1_PUBLIC_KEY = 'GPUB123TESTPHARMAKEY';
process.env.MPP_SECRET_KEY = 'SBTEST123SECRETKEY456789012345678901234567890123456789012345';
process.env.PHARMACY_PAYMENT_PORT = '0';
process.env.DATA_DIR = TEST_DATA_DIR;

vi.mock('mppx/server', () => ({
  Store: {
    memory: vi.fn(() => ({ type: 'memory' })),
    fileSystem: vi.fn((p: string) => ({ type: 'fileSystem', path: p })),
  },
  Mppx: {
    create: vi.fn(() => ({
      charge: () => () => Promise.resolve({ status: 200 }),
    })),
  },
}));
vi.mock('@stellar/mpp/charge/server', () => ({ stellar: { charge: vi.fn(() => ({})) } }));
vi.mock('@stellar/mpp', () => ({ USDC_SAC_TESTNET: 'USDC_SAC_TESTNET' }));
vi.mock('dotenv/config', () => ({}));

// Import the REAL persistence and locking implementation from server.ts
const { saveOrder, loadOrders, server } = await import('../server.ts');

describe('Pharmacy Payment - Concurrent Order Saving (#929)', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    if (existsSync(TEST_ORDERS_FILE)) {
      unlinkSync(TEST_ORDERS_FILE);
    }
    writeFileSync(TEST_ORDERS_FILE, JSON.stringify([]));
  });

  afterEach(() => {
    if (existsSync(TEST_ORDERS_FILE)) {
      unlinkSync(TEST_ORDERS_FILE);
    }
  });

  afterAll(() => {
    if (server?.close) {
      server.close();
    }
  });

  it('should save orders sequentially without losing data using real server.ts saveOrder', async () => {
    const orders: any[] = [];

    for (let i = 0; i < 10; i++) {
      const order = {
        id: `order-${i}`,
        drug: `drug-${i}`,
        pharmacy: `pharmacy-${Math.floor(i / 5)}`,
        amount: 10 + i,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      };
      orders.push(order);
      await saveOrder(order);
    }

    const savedOrders = await loadOrders();
    expect(savedOrders).toHaveLength(10);

    const ids = savedOrders.map((o: any) => o.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);

    for (const order of savedOrders) {
      expect(order).toHaveProperty('id');
      expect(order).toHaveProperty('drug');
      expect(order).toHaveProperty('pharmacy');
      expect(order).toHaveProperty('amount');
      expect(order).toHaveProperty('status');
      expect(order).toHaveProperty('timestamp');
    }
  });

  it('should save orders concurrently with Promise.all without losing data under parallel writes', async () => {
    const orders = Array.from({ length: 10 }, (_, i) => ({
      id: `parallel-order-${i}`,
      drug: `drug-${i}`,
      pharmacy: `pharmacy-${i % 3}`,
      amount: 10 + i,
      status: 'confirmed',
      timestamp: new Date().toISOString(),
    }));

    // Exercise real concurrent saveOrder calls backed by proper-lockfile in server.ts
    await Promise.all(orders.map((order) => saveOrder(order)));

    const savedOrders = await loadOrders();
    expect(savedOrders).toHaveLength(10);
    const savedIds = new Set(savedOrders.map((o: any) => o.id));
    expect(savedIds.size).toBe(10);
    for (const order of orders) {
      expect(savedIds.has(order.id)).toBe(true);
    }
  });

  it('should handle rapid sequential saves correctly', async () => {
    for (let i = 0; i < 10; i++) {
      const order = {
        id: `rapid-order-${i}`,
        drug: `drug-rapid-${i}`,
        amount: 25,
        timestamp: new Date().toISOString(),
      };
      await saveOrder(order);
    }

    const savedOrders = await loadOrders();
    expect(savedOrders).toHaveLength(10);
    expect(savedOrders[0].id).toBe('rapid-order-0');
    expect(savedOrders[9].id).toBe('rapid-order-9');
  });

  it('should maintain order consistency with multiple batches', async () => {
    for (let batch = 0; batch < 2; batch++) {
      for (let i = 0; i < 5; i++) {
        const order = {
          id: `batch-${batch}-order-${i}`,
          batchNumber: batch,
          orderInBatch: i,
          amount: 15 + batch * 100 + i,
        };
        await saveOrder(order);
      }
    }

    const savedOrders = await loadOrders();
    expect(savedOrders).toHaveLength(10);

    const batch0Orders = savedOrders.filter((o: any) => o.batchNumber === 0);
    const batch1Orders = savedOrders.filter((o: any) => o.batchNumber === 1);

    expect(batch0Orders).toHaveLength(5);
    expect(batch1Orders).toHaveLength(5);
  }, 30000);
});
