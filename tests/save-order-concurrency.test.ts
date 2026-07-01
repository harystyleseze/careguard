import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import lock from 'proper-lockfile';

// Standalone re-implementation of the fixed saveOrder logic (mirroring server.ts)
// so the test does not require importing the full unified server.
async function saveOrderToFile(ordersFile: string, order: object): Promise<void> {
  if (!fs.existsSync(ordersFile)) {
    fs.writeFileSync(ordersFile, '[]', 'utf-8');
  }
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock.lock(ordersFile, {
      retries: { retries: 50, minTimeout: 5, maxTimeout: 50 },
      stale: 10000,
    });
    let orders: object[] = [];
    try {
      orders = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
    } catch {
      orders = [];
    }
    orders.push(order);
    const tmp = `${ordersFile}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(orders, null, 2), 'utf-8');
    fs.renameSync(tmp, ordersFile);
  } finally {
    if (release) {
      try { await release(); } catch {}
    }
  }
}

describe('saveOrder — concurrent write safety (issue #15)', () => {
  let tmpDir: string;
  let ordersFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'careguard-test-'));
    ordersFile = path.join(tmpDir, 'orders.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('50 concurrent saveOrder calls — all 50 orders appear in the final file', { timeout: 30000 }, async () => {
    const N = 50;
    const orders = Array.from({ length: N }, (_, i) => ({
      id: `order-${i}`,
      drug: `Drug-${i}`,
      amount: i + 1,
    }));

    // Fire all writes concurrently
    await Promise.all(orders.map((o) => saveOrderToFile(ordersFile, o)));

    const saved = JSON.parse(fs.readFileSync(ordersFile, 'utf-8')) as any[];
    expect(saved).toHaveLength(N);

    // Every order must be present — no silent losses
    const savedIds = new Set(saved.map((o) => o.id));
    for (const o of orders) {
      expect(savedIds.has(o.id)).toBe(true);
    }
  });

  it('sequential saveOrder calls also produce the correct count', async () => {
    for (let i = 0; i < 5; i++) {
      await saveOrderToFile(ordersFile, { id: `order-${i}` });
    }
    const saved = JSON.parse(fs.readFileSync(ordersFile, 'utf-8'));
    expect(saved).toHaveLength(5);
  });
});
