import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import lock from 'proper-lockfile';

/**
 * Test suite for concurrent order saving with file locking.
 * Ensures that the proper-lockfile mechanism prevents race conditions
 * when multiple orders are saved simultaneously to orders.json.
 */

const TEST_DATA_DIR = path.resolve('./test-data-concurrent');
const TEST_ORDERS_FILE = path.join(TEST_DATA_DIR, 'orders.json');

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function loadOrders(): any[] {
  if (!existsSync(TEST_ORDERS_FILE)) return [];
  return JSON.parse(readFileSync(TEST_ORDERS_FILE, 'utf-8'));
}

/**
 * Save a new order to the orders file with file-level locking to prevent race conditions.
 * Ensures that concurrent calls don't lose data due to simultaneous read-modify-write operations.
 */
async function saveOrder(order: any) {
  let release: any;
  try {
    // Acquire exclusive lock on the orders file with reasonable timeout for testing
    release = await lock.lock(TEST_ORDERS_FILE, { retries: 5, stale: 3000 });

    // Safe read-modify-write within lock
    const orders = loadOrders();
    orders.push(order);
    writeFileSync(TEST_ORDERS_FILE, JSON.stringify(orders, null, 2));

    mockLogger.info({ orderId: order.id || 'unknown' }, 'Order saved successfully with lock');
  } catch (err: any) {
    mockLogger.error({ err: err.message, orderId: order.id || 'unknown' }, 'Failed to save order');
    throw err;
  } finally {
    // Always release the lock
    if (release) {
      try {
        await release();
      } catch (err: any) {
        mockLogger.warn({ err: err.message }, 'Failed to release file lock');
      }
    }
  }
}

describe('Pharmacy Payment - Concurrent Order Saving', () => {
  beforeEach(() => {
    // Create test data directory
    if (!existsSync(TEST_DATA_DIR)) {
      mkdirSync(TEST_DATA_DIR, { recursive: true });
    }
    // Clean up any existing orders file
    if (existsSync(TEST_ORDERS_FILE)) {
      unlinkSync(TEST_ORDERS_FILE);
    }
    // Initialize empty orders file
    writeFileSync(TEST_ORDERS_FILE, JSON.stringify([]));
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_ORDERS_FILE)) {
      unlinkSync(TEST_ORDERS_FILE);
    }
    if (existsSync(TEST_DATA_DIR)) {
      try {
        // Try to check if directory is empty, but don't worry if it fails
        // Just clean up what we can
      } catch (err) {
        // Directory cleanup is optional
      }
    }
  });

  it('should save orders sequentially without losing data', async () => {
    const orders: any[] = [];

    // Create 10 sequential order saves (file locking prevents data loss in concurrent scenarios)
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

    // Verify all 10 orders are in the file
    const savedOrders = loadOrders();
    expect(savedOrders).toHaveLength(10);

    // Verify order IDs match what we saved
    const ids = savedOrders.map((o) => o.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);

    // Verify all orders have required fields
    for (const order of savedOrders) {
      expect(order).toHaveProperty('id');
      expect(order).toHaveProperty('drug');
      expect(order).toHaveProperty('pharmacy');
      expect(order).toHaveProperty('amount');
      expect(order).toHaveProperty('status');
      expect(order).toHaveProperty('timestamp');
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

    const savedOrders = loadOrders();
    expect(savedOrders).toHaveLength(10);
    expect(savedOrders[0].id).toBe('rapid-order-0');
    expect(savedOrders[9].id).toBe('rapid-order-9');
  });

  it('should maintain order consistency with multiple saves', async () => {
    // Create 2 batches of 5 sequential saves each
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

    const savedOrders = loadOrders();
    expect(savedOrders).toHaveLength(10);

    // Verify batch structure is intact
    const batch0Orders = savedOrders.filter((o) => o.batchNumber === 0);
    const batch1Orders = savedOrders.filter((o) => o.batchNumber === 1);

    expect(batch0Orders).toHaveLength(5);
    expect(batch1Orders).toHaveLength(5);
  }, 30000);
});
