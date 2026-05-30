// vi.hoisted runs before any vi.mock factory — sets env vars + captures mutable refs
const { mockX402Fetch, mockDecodePaymentResponseHeader, mockHorizonTransactionCall } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  return {
    mockX402Fetch: vi.fn(),
    mockDecodePaymentResponseHeader: vi.fn(),
    mockHorizonTransactionCall: vi.fn(),
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
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB123", sign: vi.fn() }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn().mockReturnValue({ sign: vi.fn() }),
  }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
      transactions: vi.fn().mockReturnValue({
        transaction: vi.fn().mockReturnValue({
          call: mockHorizonTransactionCall,
        }),
      }),
    }),
  },
}));
vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(mockX402Fetch),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
  decodePaymentResponseHeader: mockDecodePaymentResponseHeader,
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  comparePharmacyPrices,
  auditBill,
  checkDrugInteractions,
  getSpendingSummary,
  getSpendingTracker,
  reconcilePendingServiceFees,
  resetSpendingTracker,
} from "../tools.ts";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: {
      get: (name: string) => {
        const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
        return hit?.[1] ?? null;
      },
    },
  } as any;
}

describe("x402 service fee settlement tracking", () => {
  beforeEach(() => {
    resetSpendingTracker();
    mockX402Fetch.mockReset();
    mockDecodePaymentResponseHeader.mockReset();
    mockHorizonTransactionCall.mockReset();
  });

  it("records service fees as pending settlement when response has no tx hash", async () => {
    mockX402Fetch.mockResolvedValueOnce(jsonResponse({ protocol: { payTo: "pharmacy-price-api" }, prices: [] }));

    await comparePharmacyPrices("Metformin", "90210");

    const tracker = getSpendingTracker() as any;
    expect(tracker.serviceFees).toBe(0);
    expect(tracker.pendingServiceFees).toBe(0.002);
    expect(tracker.transactions).toHaveLength(1);
    expect(tracker.transactions[0].status).toBe("pending_settlement");
    expect(tracker.transactions[0].stellarTxHash).toBeUndefined();
  });

  it("reconciliation confirms a pending fee when Horizon can find the tx hash", async () => {
    mockDecodePaymentResponseHeader.mockReturnValueOnce({ transaction: "txhash-123" });
    mockX402Fetch.mockResolvedValueOnce(
      jsonResponse({ protocol: { payTo: "bill-audit-api" }, ok: true }, { "PAYMENT-RESPONSE": "encoded" })
    );
    mockHorizonTransactionCall.mockResolvedValueOnce({ id: "txhash-123" });

    await auditBill([{ description: "x", cptCode: "123", quantity: 1, chargedAmount: 50 }]);
    await reconcilePendingServiceFees();

    const tracker = getSpendingTracker() as any;
    expect(tracker.pendingServiceFees).toBe(0);
    expect(tracker.serviceFees).toBe(0.01);
    expect(tracker.transactions[0].status).toBe("completed");
    expect(tracker.transactions[0].stellarTxHash).toBe("txhash-123");
  });

  it("reconciliation marks old unresolved pending fees as failed without double-counting", async () => {
    mockDecodePaymentResponseHeader.mockReturnValueOnce({ transaction: "txhash-missing" });
    mockX402Fetch.mockResolvedValueOnce(
      jsonResponse({ protocol: { payTo: "drug-interaction-api" }, ok: true }, { "PAYMENT-RESPONSE": "encoded" })
    );
    mockHorizonTransactionCall.mockRejectedValueOnce({ response: { status: 404 } });

    await checkDrugInteractions(["Aspirin", "Warfarin"]);
    const trackerBefore = getSpendingTracker() as any;
    trackerBefore.transactions[0].timestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();

    await reconcilePendingServiceFees();

    const summary = getSpendingSummary() as any;
    const tracker = getSpendingTracker() as any;
    expect(tracker.pendingServiceFees).toBe(0);
    expect(tracker.serviceFees).toBe(0);
    expect(tracker.transactions[0].status).toBe("failed");
    expect(summary.spending.pendingServiceFees).toBe(0);
    expect(summary.spending.serviceFees).toBe(0);
  });
});
