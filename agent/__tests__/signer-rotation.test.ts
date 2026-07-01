// vi.hoisted must set env vars and define mocks before any vi.mock factory executes
const { MOCK_HINT, mockCreateEd25519Signer, mockWrapFetchWithPayment, mockX402ClientRegister } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = ""; // not mock network — tests real signer path
  process.env.SPENDING_TIMEZONE = "UTC";
  return {
    MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
    mockCreateEd25519Signer: vi.fn().mockReturnValue({}),
    mockWrapFetchWithPayment: vi.fn().mockImplementation(() => vi.fn()),
    mockX402ClientRegister: vi.fn().mockReturnThis(),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((p: string) => {
    if (String(p).includes("spending.snapshot.json")) return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [], _snapshotTxCount: 0 });
    if (String(p).includes("spending.json")) return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
    return "{}";
  }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn((p: string) => String(p).includes("spending")),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB", sign: vi.fn(), signatureHint: vi.fn().mockReturnValue(MOCK_HINT) }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({ addOperation: vi.fn().mockReturnThis(), setTimeout: vi.fn().mockReturnThis(), build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [] }) }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn(), feeStats: vi.fn() }) },
}));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: mockCreateEd25519Signer,
  ExactStellarScheme: vi.fn().mockImplementation((s: any) => s),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: mockWrapFetchWithPayment,
  x402Client: vi.fn().mockReturnValue({ register: mockX402ClientRegister }),
  decodePaymentResponseHeader: vi.fn(),
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));
vi.mock("../shared/network-mode.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../shared/network-mode.ts")>();
  return { ...original, isMockNetwork: vi.fn().mockReturnValue(false) };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getX402Fetch, X402_SIGNER_TTL_MS } from "../tools.ts";

/**
 * Vitest: x402 signer rotation (Issue #193)
 * Verifies TTL-based reload, SIGHUP immediate reload, and mock-network bypass.
 */

beforeEach(() => {
  vi.useFakeTimers();
  mockCreateEd25519Signer.mockClear();
  mockWrapFetchWithPayment.mockClear();
  // Reset the signer cache between tests by emitting SIGHUP
  process.emit("SIGHUP");
});

describe("getX402Fetch — TTL-based signer reload (Issue #193)", () => {
  it("creates a signer on the first call", () => {
    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(1);
    expect(mockCreateEd25519Signer).toHaveBeenCalledWith(process.env.AGENT_SECRET_KEY, expect.any(String));
  });

  it("reuses the cached signer within the TTL window", () => {
    getX402Fetch();
    vi.advanceTimersByTime(X402_SIGNER_TTL_MS - 1);
    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the signer after TTL expires and key is rotated", () => {
    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledWith("SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD", expect.any(String));

    // Rotate key and advance past TTL
    process.env.AGENT_SECRET_KEY = "SBNEWKEYABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLM";
    vi.advanceTimersByTime(X402_SIGNER_TTL_MS + 1);

    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(2);
    expect(mockCreateEd25519Signer).toHaveBeenLastCalledWith("SBNEWKEYABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLM", expect.any(String));

    // Restore
    process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  });
});

describe("getX402Fetch — SIGHUP immediate reload (Issue #193)", () => {
  it("invalidates the cache on SIGHUP so next call creates a fresh signer", () => {
    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(1);

    // Within TTL — normally would not rebuild
    vi.advanceTimersByTime(1_000);
    process.emit("SIGHUP");

    getX402Fetch();
    expect(mockCreateEd25519Signer).toHaveBeenCalledTimes(2);
  });
});
