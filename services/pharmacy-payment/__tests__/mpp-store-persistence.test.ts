import { describe, it, expect, vi, beforeAll } from 'vitest';
import path from 'path';

/**
 * Vitest: MPP store persistence (Issue #200)
 *
 * Verifies that the pharmacy-payment service uses Store.fileSystem() rather than
 * Store.memory(), so in-flight payment challenge state survives a process restart.
 *
 * Module-level setup: mocks must be registered before the server module is imported.
 * We capture the Store call arguments during the single module load.
 */

const mockMemory = vi.fn(() => ({ type: 'memory' }));
const mockFileSystem = vi.fn((filePath: string) => ({ type: 'fileSystem', filePath }));
const mockStellarCharge = vi.fn(() => ({}));
const mockMppxCreate = vi.fn(() => ({}));

vi.mock('mppx/server', () => ({
  Store: {
    memory: mockMemory,
    fileSystem: mockFileSystem,
  },
  Mppx: { create: mockMppxCreate },
}));

vi.mock('@stellar/mpp/charge/server', () => ({
  stellar: { charge: mockStellarCharge },
}));

vi.mock('@stellar/mpp', () => ({
  USDC_SAC_TESTNET: 'USDC_SAC_TESTNET',
}));

vi.mock('dotenv/config', () => ({}));

const mockApp = {
  use: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  listen: vi.fn(() => ({ close: vi.fn() })),
};
vi.mock('express', () => {
  const express = vi.fn(() => mockApp);
  (express as any).json = vi.fn(() => vi.fn());
  return { default: express };
});
vi.mock('../../shared/cors.ts', () => ({ createCorsMiddleware: vi.fn(() => vi.fn()) }));
vi.mock('../../shared/security-middleware.ts', () => ({ applySecurityMiddleware: vi.fn() }));
vi.mock('../../shared/logger.ts', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../shared/request-context.ts', () => ({ requestContextMiddleware: vi.fn(() => vi.fn()) }));
vi.mock('../../shared/request-logger.ts', () => ({ requestLoggerMiddleware: vi.fn(() => vi.fn()) }));
vi.mock('../../shared/sanitize.ts', () => ({ sanitizeUserString: vi.fn((s: string) => s) }));
vi.mock('./validation.ts', () => ({
  MedicationOrderSchema: { safeParse: vi.fn() },
}));
vi.mock('proper-lockfile', () => ({
  default: { lock: vi.fn(() => Promise.resolve(() => Promise.resolve())) },
}));
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));

// Capture call data after the single module load
let capturedStorePath: string | undefined;

beforeAll(async () => {
  process.env.PHARMACY_1_PUBLIC_KEY = 'GPUB123TEST';
  process.env.MPP_SECRET_KEY = 'test-mpp-secret';
  await import('../server.ts');
  capturedStorePath = mockFileSystem.mock.calls[0]?.[0];
});

describe('MPP Store Persistence (Issue #200)', () => {
  it('uses Store.fileSystem() instead of Store.memory()', () => {
    expect(mockMemory).not.toHaveBeenCalled();
    expect(mockFileSystem).toHaveBeenCalledTimes(1);
  });

  it('Store.fileSystem() receives a path ending in mpp-store.json', () => {
    expect(capturedStorePath).toMatch(/mpp-store\.json$/);
  });

  it('Store.fileSystem() path is inside an absolute data directory', () => {
    expect(capturedStorePath).toBeDefined();
    expect(path.isAbsolute(capturedStorePath!)).toBe(true);
    expect(capturedStorePath).toContain('data');
  });
});
