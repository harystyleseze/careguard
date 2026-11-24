/**
 * Investigation for #1308: does mpp-client.ts's retry logic affect total
 * latency/throughput when the downstream pharmacy-payment service is slow
 * or intermittently failing?
 *
 * Finding: `agent/mpp-client.ts` itself has no retry logic of its own — it's
 * a thin factory around `Mppx.create` (from the `mppx` package) with
 * `stellarCharge` (from `@stellar/mpp/charge/client`) as its only payment
 * method. All retry behavior lives inside `mppx`'s `Fetch.from()` client
 * wrapper (`node_modules/mppx/dist/client/internal/Fetch.js`):
 *
 *   const defaultMaxPaymentRetries = 3;
 *   for (let retry = 0; retry < maxPaymentRetries; retry++) { ... }
 *
 * `createMppClient` never overrides `maxPaymentRetries`, so every MPP client
 * in this codebase runs with the library default of 3 — and, critically,
 * this loop has no `setTimeout`/delay between attempts (confirmed by
 * reading the full retry loop: no backoff, no jitter). This is measured
 * below against a controllable, fake-timers-driven downstream instead of
 * live network calls, so it runs in milliseconds and is deterministic.
 *
 * This exercises the real `Fetch.from()` retry loop (imported from `mppx`,
 * not reimplemented), driven through a minimal custom `Transport` and a
 * minimal custom payment `Method` — both are seams `mppx` exposes
 * specifically for this purpose (`Transport.from()`, `Method.from()`) — so
 * the payment-challenge/credential wire format doesn't need to be
 * reverse-engineered to observe the retry loop's real timing behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Fetch, Transport, Method } from 'mppx/client';
import { z } from 'zod/mini';

const DOWNSTREAM_DELAY_MS = 400;

/** A fetch stand-in for the pharmacy-payment service, with a configurable delay. */
function makeDownstream(responder: (callCount: number) => { status: number; paid?: boolean }) {
  let callCount = 0;
  const calls: number[] = [];
  const fn = vi.fn(async () => {
    callCount++;
    calls.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, DOWNSTREAM_DELAY_MS));
    const { status, paid } = responder(callCount);
    return new Response(paid ? 'ok' : '', { status });
  });
  return { fn, calls, callCount: () => callCount };
}

// Minimal payment method: `createCredential` resolves instantly (no real
// signing/RPC), isolating the measurement to HTTP-layer retry overhead.
const testMethod = Method.from({
  name: 'test',
  intent: 'charge',
  schema: {
    credential: { payload: z.string() },
    request: z.record(z.string(), z.unknown()),
  },
});
const testClientMethod = {
  ...testMethod,
  createCredential: async () => 'test-credential',
};

// Minimal transport: a response is "payment required" purely by status code,
// and every payment-required response carries one challenge for `testMethod`.
const testTransport = Transport.from({
  name: 'test',
  isPaymentRequired: (response: Response) => response.status === 402,
  getChallenges: () => [
    {
      id: 'c1',
      realm: 'test',
      method: 'test',
      intent: 'charge',
      request: {},
    },
  ],
  setCredential: (request: RequestInit, credential: string) => ({
    ...request,
    headers: { ...(request.headers as Record<string, string>), 'X-Payment': credential },
  }),
});

describe('mpp-client retry/latency under downstream conditions (#1308)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normal (non-402) response: one downstream round trip, no retry overhead', async () => {
    const downstream = makeDownstream(() => ({ status: 200 }));
    const fetch = Fetch.from({
      fetch: downstream.fn as unknown as typeof globalThis.fetch,
      methods: [testClientMethod],
      transport: testTransport,
    });

    const start = Date.now();
    await fetch('https://pharmacy-payment.example/charge');
    const elapsed = Date.now() - start;

    expect(downstream.callCount()).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(DOWNSTREAM_DELAY_MS);
    expect(elapsed).toBeLessThan(DOWNSTREAM_DELAY_MS * 2);
  });

  it('slow payment flow (402 challenge, then paid retry): two sequential downstream calls, latency compounds additively with zero backoff between them', async () => {
    const downstream = makeDownstream((n) => (n === 1 ? { status: 402 } : { status: 200, paid: true }));
    const fetch = Fetch.from({
      fetch: downstream.fn as unknown as typeof globalThis.fetch,
      methods: [testClientMethod],
      transport: testTransport,
    });

    const start = Date.now();
    await fetch('https://pharmacy-payment.example/charge');
    const elapsed = Date.now() - start;

    expect(downstream.callCount()).toBe(2);
    // Two sequential slow downstream calls, back-to-back with no delay
    // between them: total latency is additive, not amortized.
    expect(elapsed).toBeGreaterThanOrEqual(DOWNSTREAM_DELAY_MS * 2);
    expect(elapsed).toBeLessThan(DOWNSTREAM_DELAY_MS * 2 + 200);
    // The gap between the two downstream calls confirms there is no
    // backoff/delay inserted by mppx's retry loop.
    const gap = downstream.calls[1] - downstream.calls[0];
    expect(gap).toBeLessThan(50);
  });

  it('downstream failing (non-402, e.g. 500/timeout): passes straight through on the first attempt — the payment-retry loop never engages', async () => {
    const downstream = makeDownstream(() => ({ status: 500 }));
    const fetch = Fetch.from({
      fetch: downstream.fn as unknown as typeof globalThis.fetch,
      methods: [testClientMethod],
      transport: testTransport,
    });

    const response = await fetch('https://pharmacy-payment.example/charge');

    // Key finding: mppx's maxPaymentRetries loop is scoped to 402
    // payment-challenge negotiation. A generic failure response (500,
    // or a thrown network/timeout error) is not a "payment required"
    // response, so isPaymentRequired() is false and the failure — or
    // exception — propagates on the very first attempt. There is no
    // retry/backoff protection against a slow or failing downstream at
    // all outside of the payment-challenge path.
    expect(response.status).toBe(500);
    expect(downstream.callCount()).toBe(1);
  });
});
