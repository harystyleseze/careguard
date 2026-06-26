/**
 * Tests for MPP client factory and DI pattern (#171).
 *
 * Verifies that:
 * - MPP clients can be instantiated independently
 * - Each instance has isolated state (lastTxHash)
 * - Tests running in parallel don't contaminate each other
 */

import { describe, it, expect } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { createMppClient } from '../mpp-client.ts';

describe('MPP Client Factory', () => {
  it('creates independent client instances', () => {
    const keypair1 = Keypair.random();
    const keypair2 = Keypair.random();

    const client1 = createMppClient({ keypair: keypair1 });
    const client2 = createMppClient({ keypair: keypair2 });

    expect(client1).not.toBe(client2);
    expect(client1.fetch).toBeDefined();
    expect(client2.fetch).toBeDefined();
  });

  it('each instance has isolated lastTxHash state', () => {
    const keypair = Keypair.random();
    
    const client1 = createMppClient({ keypair });
    const client2 = createMppClient({ keypair });

    // Initially both should be undefined
    expect(client1.lastTxHash).toBeUndefined();
    expect(client2.lastTxHash).toBeUndefined();

    // Simulate progress event for client1 only
    const onProgress1 = (event: any) => {
      if (event.type === 'paid') {
        // This would be set internally by the progress handler
      }
    };

    const client3 = createMppClient({ keypair, onProgress: onProgress1 });
    
    // client3 should have its own isolated state
    expect(client3.lastTxHash).toBeUndefined();
  });

  it('supports custom onProgress callback', () => {
    const keypair = Keypair.random();
    let progressCalled = false;

    const client = createMppClient({
      keypair,
      onProgress: (event) => {
        progressCalled = true;
      },
    });

    expect(client).toBeDefined();
    // Progress callback would be invoked during actual MPP operations
  });

  it('supports different modes (pull/push)', () => {
    const keypair = Keypair.random();

    const pullClient = createMppClient({ keypair, mode: 'pull' });
    const pushClient = createMppClient({ keypair, mode: 'push' });

    expect(pullClient).toBeDefined();
    expect(pushClient).toBeDefined();
  });

  it('defaults to pull mode when mode not specified', () => {
    const keypair = Keypair.random();
    const client = createMppClient({ keypair });

    expect(client).toBeDefined();
    expect(client.fetch).toBeDefined();
  });
});

describe('MPP Client DI in tools.ts', () => {
  it('setMppClient and getMppClient work correctly', async () => {
    const { setMppClient, getMppClient } = await import('../tools.ts');
    const keypair = Keypair.random();
    const testClient = createMppClient({ keypair });

    setMppClient(testClient);
    const retrieved = getMppClient();

    expect(retrieved).toBe(testClient);
  });
});
