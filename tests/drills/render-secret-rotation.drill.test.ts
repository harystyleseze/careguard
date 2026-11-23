/**
 * Game-Day Drill #965: Render sync:false secret rotation invariants.
 *
 * Verifies statically/in-unit-test that:
 * 1. render.yaml marks secret env vars with `sync: false` so Render does not auto-restart.
 * 2. Cached x402 signer does NOT pick up an updated AGENT_SECRET_KEY within TTL without SIGHUP.
 * 3. SIGHUP immediately invalidates the signer cache so the next call loads the rotated key.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreateEd25519Signer } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "0";
  return {
    mockCreateEd25519Signer: vi.fn().mockReturnValue({}),
  };
});

vi.mock("@x402/stellar", () => ({
  createEd25519Signer: mockCreateEd25519Signer,
  ExactStellarScheme: vi.fn().mockImplementation((s: unknown) => s),
}));

vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockImplementation(() => vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
}));

import {
  getX402Fetch,
  invalidateX402SignerCache,
  X402_SIGNER_TTL_MS,
} from "../../shared/x402-signer.ts";

describe("Drill #965: Render sync:false secret rotation", () => {
  const originalKey = process.env.AGENT_SECRET_KEY;

  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateEd25519Signer.mockClear();
    invalidateX402SignerCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.AGENT_SECRET_KEY = originalKey;
  });

  it("render.yaml declares AGENT_SECRET_KEY and other secrets with sync: false", () => {
    const renderYaml = readFileSync(resolve(process.cwd(), "render.yaml"), "utf-8");
    expect(renderYaml).toMatch(/- key: AGENT_SECRET_KEY\s+sync: false/);
    expect(renderYaml).toMatch(/- key: OZ_FACILITATOR_API_KEY\s+sync: false/);
    expect(renderYaml).toMatch(/- key: MPP_SECRET_KEY\s+sync: false/);
  });

  it("keeps using the stale cached signer after env update until SIGHUP or TTL expiry", () => {
    const initialFetch = getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(1);

    // Simulate Render sync:false env update without SIGHUP/restart
    process.env.AGENT_SECRET_KEY = "SBROTATEDKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789";
    vi.advanceTimersByTime(X402_SIGNER_TTL_MS - 5000);

    const stillCachedFetch = getX402Fetch();
    expect(stillCachedFetch).toBe(initialFetch);
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(1);

    // Simulate SIGHUP sent via Render Shell
    process.emit("SIGHUP");

    const rotatedFetch = getX402Fetch();
    expect(rotatedFetch).not.toBe(initialFetch);
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(2);
    expect(mockCreateEd25519Signer).toHaveBeenLastCalledWith(
      "SBROTATEDKEY1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
      expect.any(String),
    );
  });
});
