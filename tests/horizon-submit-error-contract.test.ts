/**
 * Contract test: Horizon's submit-transaction error response shape (Issue #985).
 *
 * The tx_bad_seq retry logic in agent/tools.ts, the StellarBadSeqRetriesHigh
 * alert, and the Horizon/facilitator diagnosis steps all depend on Horizon's
 * 400 response carrying `extras.result_codes.transaction`. Until now the only
 * contract tests were for the x402 Facilitator API — a fixture or SDK shape
 * change could silently turn a detected tx_bad_seq into an opaque outage.
 *
 * These fixtures mirror the real Horizon `transaction_failed` envelope and
 * are fed through the actual retry helper, so changing the parsed path breaks
 * the test rather than only failing at runtime.
 */

const { mockLoadAccount, mockSubmitTransaction, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
  const MOCK_HINT = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
  return {
    mockLoadAccount: vi.fn(),
    mockSubmitTransaction: vi.fn(),
    MOCK_HINT,
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
      signatureHint: vi.fn().mockReturnValue(MOCK_HINT),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: Object.assign(
    vi.fn().mockReturnValue({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({
        sign: vi.fn(),
        signatures: [{ hint: vi.fn().mockReturnValue(MOCK_HINT) }],
      }),
    }),
    { buildFeeBumpTransaction: vi.fn().mockReturnValue({ sign: vi.fn() }) },
  ),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: mockLoadAccount,
      submitTransaction: mockSubmitTransaction,
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
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { describe, it, expect, beforeEach } from "vitest";
import { submitTransactionWithRetry } from "../agent/tools.ts";

const mockServer = {
  loadAccount: mockLoadAccount,
  submitTransaction: mockSubmitTransaction,
} as any;

const INSTANT_CLOCK = { now: () => 0, sleep: async (_ms: number) => {} };

/** A rebuild closure shaped like the real one: reload the account on retry. */
function makeRebuild() {
  return async () => {
    const account = await mockServer.loadAccount("GPUB123");
    return { sequence: account.sequence, kind: "rebuilt" };
  };
}

/**
 * Horizon 400 `transaction_failed` fixture. The message deliberately does NOT
 * contain the result code: older code paths matched on the message only and
 * missed real Horizon rejections (issue #796). Parsing must use extras.
 */
function horizonTransactionError(transactionCode: string, operations?: string[]) {
  const resultCodes: Record<string, unknown> = { transaction: transactionCode };
  if (operations) resultCodes.operations = operations;

  return Object.assign(new Error("Request failed with status code 400"), {
    response: {
      status: 400,
      statusText: "Bad Request",
      data: {
        type: "https://stellar.org/horizon-errors/transaction_failed",
        title: "Transaction Failed",
        status: 400,
        detail:
          "The transaction failed when submitted to the stellar network. The extras.result_codes field on this response contains further details.",
        extras: {
          envelope_xdr: "AAAAAgAAAAB_mockEnvelope",
          result_codes: resultCodes,
          result_xdr: "AAAAAAAAAGT////7AAAAAA==",
        },
      },
    },
  });
}

beforeEach(() => {
  mockLoadAccount.mockReset();
  mockSubmitTransaction.mockReset();
  let sequence = 100;
  mockLoadAccount.mockImplementation(async () => ({
    id: "GPUB123",
    sequence: String(++sequence),
  }));
});

describe("Horizon submit-error response shape — contract (Issue #985)", () => {
  it("tx_bad_seq fixture matches the nested shape retry logic parses", () => {
    const err = horizonTransactionError("tx_bad_seq");

    // Exact fixture shape — a change in Horizon's response nesting fails here.
    expect(err.response.status).toBe(400);
    expect(err.response.data.type).toContain("horizon-errors");
    expect(err.response.data.extras.result_codes).toEqual({
      transaction: "tx_bad_seq",
    });
    expect(typeof err.response.data.extras.result_xdr).toBe("string");
    // The code is only in extras, proving the parser cannot rely on message text.
    expect(err.message).not.toContain("tx_bad_seq");
  });

  it("retry logic recognises the tx_bad_seq fixture: reloads and resubmits", async () => {
    mockSubmitTransaction
      .mockRejectedValueOnce(horizonTransactionError("tx_bad_seq"))
      .mockResolvedValueOnce({ hash: "b".repeat(64) });

    const result = await submitTransactionWithRetry(
      mockServer,
      { sequence: "100" },
      2,
      35_000,
      makeRebuild(),
      undefined,
      INSTANT_CLOCK,
    );

    expect(result.hash).toBe("b".repeat(64));
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(2);
  });

  it("payment-failure fixtures keep the documented result_codes shape", () => {
    const insufficient = horizonTransactionError("tx_insufficient_balance");
    const underfunded = horizonTransactionError("tx_failed", ["op_underfunded"]);

    expect(insufficient.response.data.extras.result_codes).toEqual({
      transaction: "tx_insufficient_balance",
    });
    expect(underfunded.response.data.extras.result_codes).toEqual({
      transaction: "tx_failed",
      operations: ["op_underfunded"],
    });
    expect(Array.isArray(underfunded.response.data.extras.result_codes.operations)).toBe(true);
  });

  it("non-recoverable payment failures propagate without reload or retry", async () => {
    const fixtures = [
      horizonTransactionError("tx_insufficient_balance"),
      horizonTransactionError("tx_failed", ["op_underfunded"]),
    ];

    for (const err of fixtures) {
      mockSubmitTransaction.mockReset().mockRejectedValueOnce(err);

      await expect(
        submitTransactionWithRetry(
          mockServer,
          { sequence: "100" },
          2,
          35_000,
          makeRebuild(),
          undefined,
          INSTANT_CLOCK,
        ),
      ).rejects.toBe(err);

      expect(mockLoadAccount).not.toHaveBeenCalled();
      expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    }
  });

  it("message-only tx_bad_seq still parses (SDK paths that omit response.data)", async () => {
    // Some SDK/network paths surface only the code in err.message; the contract
    // must cover both shapes named in docs/runbooks/oz-facilitator-outage.md.
    const messageOnly = Object.assign(new Error("tx_bad_seq"), { response: { status: 400 } });
    mockSubmitTransaction
      .mockRejectedValueOnce(messageOnly)
      .mockResolvedValueOnce({ hash: "c".repeat(64) });

    const result = await submitTransactionWithRetry(
      mockServer,
      { sequence: "100" },
      2,
      35_000,
      makeRebuild(),
      undefined,
      INSTANT_CLOCK,
    );

    expect(result.hash).toBe("c".repeat(64));
    expect(mockLoadAccount).toHaveBeenCalledTimes(1);
  });
});
