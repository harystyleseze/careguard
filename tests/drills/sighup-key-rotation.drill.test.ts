/**
 * Game-Day Drill #964: SIGHUP AGENT_SECRET_KEY rotation under live traffic.
 *
 * Verifies:
 * 1. An in-flight request that already obtained `getX402Fetch()` before SIGHUP
 *    completes using the old signer reference.
 * 2. The next call to `getX402Fetch()` after SIGHUP constructs a fresh signer
 *    with the rotated AGENT_SECRET_KEY.
 * 3. Without SIGHUP, the 60-second TTL fallback rotates to the new key once expired.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateEd25519Signer, mockWrapFetchWithPayment } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBOLDKEY1111111111111111111111111111111111111111111111111";
  process.env.MOCK_NETWORK = "0";
  return {
    mockCreateEd25519Signer: vi.fn((key: string) => ({ key })),
    mockWrapFetchWithPayment: vi.fn((_fetch: unknown, client: { signerKey?: string }) => {
      return vi.fn(async () => ({ signerKey: client?.signerKey }));
    }),
  };
});

vi.mock("@x402/stellar", () => ({
  createEd25519Signer: mockCreateEd25519Signer,
  ExactStellarScheme: vi.fn().mockImplementation((signer: { key: string }) => signer),
}));

vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: mockWrapFetchWithPayment,
  x402Client: vi.fn().mockImplementation(() => {
    const state: { signerKey?: string } = {};
    return {
      register: vi.fn((_scheme: string, schemeImpl: { key: string }) => {
        state.signerKey = schemeImpl.key;
        return state;
      }),
    };
  }),
}));

import {
  getX402Fetch,
  invalidateX402SignerCache,
  X402_SIGNER_TTL_MS,
} from "../../shared/x402-signer.ts";

describe("Drill #964: SIGHUP key rotation under live traffic", () => {
  const OLD_KEY = "SBOLDKEY1111111111111111111111111111111111111111111111111";
  const NEW_KEY = "SBNEWKEY2222222222222222222222222222222222222222222222222";

  beforeEach(() => {
    vi.useFakeTimers();
    process.env.AGENT_SECRET_KEY = OLD_KEY;
    mockCreateEd25519Signer.mockClear();
    mockWrapFetchWithPayment.mockClear();
    invalidateX402SignerCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.AGENT_SECRET_KEY = OLD_KEY;
  });

  it("allows in-flight request to settle on old key while next request after SIGHUP uses new key", async () => {
    // 1. In-flight request acquires fetch before SIGHUP
    const inFlightFetch = getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenLastCalledWith(OLD_KEY, expect.any(String));

    // 2. Rotate env + send SIGHUP mid-flight
    process.env.AGENT_SECRET_KEY = NEW_KEY;
    process.emit("SIGHUP");

    // 3. In-flight request settles using the old signer reference
    const inFlightResult = (await (inFlightFetch as unknown as () => Promise<{ signerKey: string }>)()) as {
      signerKey: string;
    };
    expect(inFlightResult.signerKey).toBe(OLD_KEY);

    // 4. Next new request acquires a fresh signer with the new key
    const postSighupFetch = getX402Fetch();
    expect(postSighupFetch).not.toBe(inFlightFetch);
    const postResult = (await (postSighupFetch as unknown as () => Promise<{ signerKey: string }>)()) as {
      signerKey: string;
    };
    expect(postResult.signerKey).toBe(NEW_KEY);
  });

  it("rotates via 60-second TTL fallback when no SIGHUP is sent", () => {
    const firstFetch = getX402Fetch();
    process.env.AGENT_SECRET_KEY = NEW_KEY;

    // Within TTL: still uses old signer
    vi.advanceTimersByTime(X402_SIGNER_TTL_MS - 1);
    expect(getX402Fetch()).toBe(firstFetch);

    // Past TTL: reloads new key automatically
    vi.advanceTimersByTime(2);
    const reloadedFetch = getX402Fetch();
    expect(reloadedFetch).not.toBe(firstFetch);
    expect(mockCreateEd25519Signer).toHaveBeenLastCalledWith(NEW_KEY, expect.any(String));
  });
});
