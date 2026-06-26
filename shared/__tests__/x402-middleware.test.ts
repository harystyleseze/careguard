const { getSupportedMock, middlewareMock } = vi.hoisted(() => ({
  getSupportedMock: vi.fn(),
  middlewareMock: vi.fn((_req: any, _res: any, next: any) => next()),
}));

vi.mock('@x402/express', () => ({
  paymentMiddlewareFromConfig: vi.fn(() => middlewareMock),
}));

vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: vi.fn().mockImplementation(() => ({
    getSupported: getSupportedMock,
  })),
}));

vi.mock('@x402/stellar/exact/server', () => ({
  ExactStellarScheme: vi.fn(),
}));

vi.mock('../logger.ts', () => ({
  logger: {
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyX402Middleware,
  createX402HealthGate,
  handleX402UnhandledRejection,
  x402FacilitatorState,
} from '../x402-middleware.ts';
import { logger } from '../logger.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  getSupportedMock.mockReset();
  x402FacilitatorState.healthy = true;
  x402FacilitatorState.lastCheckedAt = undefined;
  x402FacilitatorState.lastError = undefined;
});

describe('x402 facilitator failure handling', () => {
  it('logs critical and exits when startup facilitator sync rejects', () => {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`exit:${code}`);
      }) as never);

    expect(() =>
      handleX402UnhandledRejection(
        new Error('Failed to initialize: no supported payment kinds'),
      ),
    ).toThrow('exit:1');

    expect(logger.fatal).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    expect(x402FacilitatorState.healthy).toBe(false);
  });

  it('returns 503 on paid routes when periodic health check fails after boot', async () => {
    vi.useFakeTimers();
    getSupportedMock.mockRejectedValue(new Error('facilitator unavailable'));

    applyX402Middleware(
      { use: vi.fn() } as any,
      {
        'GET /paid': {
          accepts: {
            scheme: 'exact',
            network: 'stellar:testnet',
            payTo: 'GPAYTO',
            price: '$0.002',
          },
          description: 'paid route',
        },
      },
      {
        apiKey: 'test-key',
        healthCheckIntervalMs: 10,
      },
    );

    await vi.advanceTimersByTimeAsync(10);

    const gate = createX402HealthGate([{ method: 'GET', path: '/paid' }]);
    const next = vi.fn();
    const paidRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const freeRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    gate({ method: 'GET', path: '/paid' } as any, paidRes, next);
    gate({ method: 'GET', path: '/free' } as any, freeRes, next);

    expect(paidRes.status).toHaveBeenCalledWith(503);
    expect(paidRes.json).toHaveBeenCalledWith({
      error: 'x402 facilitator unavailable; paid route temporarily disabled',
    });
    expect(freeRes.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
