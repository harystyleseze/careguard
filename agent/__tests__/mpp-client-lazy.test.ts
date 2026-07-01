/**
 * Tests for lazy getMppClient() getter with 60s cache and SIGHUP invalidation (Issue #196).
 */

const { mppCreateSpy, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  const mppCreateSpy = vi.fn().mockReturnValue({ fetch: vi.fn() });
  return { mppCreateSpy, MOCK_HINT };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: vi.fn().mockReturnValue(MOCK_HINT),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [] }),
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn() }) },
}));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: vi.fn(),
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: mppCreateSpy } }));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getMppClient, invalidateMppClientCache } from "../tools.ts";

beforeEach(() => {
  invalidateMppClientCache();
  mppCreateSpy.mockClear();
});

describe("getMppClient() — lazy 60s cache (Issue #196)", () => {
  it("creates a new client on first call", () => {
    getMppClient();
    expect(mppCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the same instance on subsequent calls within the cache window", () => {
    const c1 = getMppClient();
    const c2 = getMppClient();
    expect(c1).toBe(c2);
    expect(mppCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("creates a new client after invalidateMppClientCache()", () => {
    getMppClient();
    invalidateMppClientCache();
    getMppClient();
    expect(mppCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("SIGHUP signal invalidates the cache — next call creates a new client", () => {
    getMppClient();
    process.emit("SIGHUP");
    getMppClient();
    expect(mppCreateSpy).toHaveBeenCalledTimes(2);
  });

  it("creates a new client once the 60s TTL expires", () => {
    vi.useFakeTimers();
    getMppClient();
    vi.advanceTimersByTime(61_000);
    getMppClient();
    expect(mppCreateSpy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
