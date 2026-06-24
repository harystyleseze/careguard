/**
 * MPP Client Factory — Dependency injection for testing (#171)
 *
 * Provides a factory function to create MPP client instances instead of
 * a module-scoped singleton. This allows tests to instantiate their own
 * clients, preventing shared state contamination across parallel tests.
 */

import { Keypair } from '@stellar/stellar-sdk';
import { Mppx } from 'mppx/client';
import { stellar as stellarCharge } from '@stellar/mpp/charge/client';
import { logger } from '../shared/logger.ts';

export interface MppClientOptions {
  keypair: Keypair;
  mode?: 'pull' | 'push';
  onProgress?: (event: any) => void;
}

export interface MppClientInstance {
  fetch: typeof fetch;
  lastTxHash?: string;
}

/**
 * Create a new MPP client instance with isolated state.
 * 
 * @param options - Configuration for the MPP client
 * @returns MPP client instance with fetch method and tx hash tracking
 */
export function createMppClient(options: MppClientOptions): MppClientInstance {
  let lastTxHash: string | undefined;

  const progressHandler = (event: any) => {
    logger.info(
      {
        type: event.type,
        hash: 'hash' in event ? (event as any).hash : undefined,
      },
      '[MPP] progress',
    );
    if (event.type === 'paid' && 'hash' in event) {
      lastTxHash = (event as any).hash;
    }
    if (options.onProgress) {
      options.onProgress(event);
    }
  };

  const client = Mppx.create({
    methods: [
      stellarCharge({
        keypair: options.keypair,
        mode: options.mode || 'pull',
        onProgress: progressHandler,
      }),
    ],
    polyfill: false,
  });

  return {
    fetch: client.fetch.bind(client),
    get lastTxHash() {
      return lastTxHash;
    },
  };
}
