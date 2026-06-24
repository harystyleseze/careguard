/**
 * Tests for issue #93 — verify Stellar tx signer hint before submit in payBill.
 */

// vi.hoisted runs before vi.mock factories — constants and mutable refs must live here
const { MATCHING_HINT, WRONG_HINT, mockKeypairHint, mockTxHint, mockSubmit, mockOnProgress } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBILLPROVIDER";
  const MATCHING_HINT = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const WRONG_HINT    = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  return {
    MATCHING_HINT,
    WRONG_HINT,
    mockKeypairHint: vi.fn().mockReturnValue(MATCHING_HINT),
    mockTxHint:      vi.fn().mockReturnValue(MATCHING_HINT),
    mockSubmit:      vi.fn().mockResolvedValue({ hash: "TESTHASH" }),
    mockOnProgress:  { fn: undefined as ((e: any) => void) | undefined },
  };
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
      signatureHint: mockKeypairHint,
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({
      sign: vi.fn(),
      signatures: [{ hint: mockTxHint }],
    }),
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({ id: "GPUB123", sequence: "1", balances: [] }),
      submitTransaction: mockSubmit,
    }),
  },
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
vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: vi.fn().mockImplementation((opts: any) => {
    if (opts?.onProgress) mockOnProgress.fn = opts.onProgress;
    return {};
  }),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { payBill } from "../tools.ts";

describe("#93 Stellar signature hint verification in payBill", () => {
  beforeEach(() => {
    mockSubmit.mockClear();
    // Reset hints to matching (happy path default)
    mockKeypairHint.mockReturnValue(MATCHING_HINT);
    mockTxHint.mockReturnValue(MATCHING_HINT);
  });

  it("submits when signer hint matches agentKeypair", async () => {
    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("refuses to submit when tx signer hint does not match agentKeypair", async () => {
    mockTxHint.mockReturnValue(WRONG_HINT); // tx has wrong hint

    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Signer mismatch/);
  });

  it("refuses to submit when signatures array is empty", async () => {
    // Simulate no signatures (edge: sign() failed silently)
    const { TransactionBuilder } = await import("@stellar/stellar-sdk");
    vi.mocked(TransactionBuilder).mockReturnValueOnce({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        sign: vi.fn(),
        signatures: [], // empty
      }),
    } as any);

    const result = await payBill("provider-1", "Hospital", "ER Visit", 5, true);

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Signer mismatch/);
  });
});
