import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  memoryFiles,
  mockAppendFileSync,
  mockDecodePaymentResponseHeader,
  mockHorizonCall,
  mockHorizonTransaction,
  mockPlainFetch,
  mockX402Fetch,
} = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.BILL_AUDIT_API_URL = "http://bill.test";
  process.env.DRUG_INTERACTION_API_URL = "http://drug.test";
  process.env.NODE_ENV = "test";
  process.env.PHARMACY_API_URL = "http://pharmacy.test";
  process.env.SPENDING_TIMEZONE = "UTC";
  process.env.STELLAR_NETWORK = "testnet";
  delete process.env.MOCK_NETWORK;

  const memoryFiles = new Map<string, string>();
  const mockAppendFileSync = vi.fn((filePath: string, data: string) => {
    const key = String(filePath);
    memoryFiles.set(key, (memoryFiles.get(key) ?? "") + String(data));
  });
  const mockDecodePaymentResponseHeader = vi.fn();
  const mockHorizonCall = vi.fn();
  const mockHorizonTransaction = vi.fn(() => ({ call: mockHorizonCall }));
  const mockPlainFetch = vi.fn();
  const mockX402Fetch = vi.fn();

  return {
    memoryFiles,
    mockAppendFileSync,
    mockDecodePaymentResponseHeader,
    mockHorizonCall,
    mockHorizonTransaction,
    mockPlainFetch,
    mockX402Fetch,
  };
});

vi.mock("dotenv/config", () => ({}));

vi.mock("fs", () => ({
  appendFileSync: mockAppendFileSync,
  existsSync: vi.fn((filePath: string) => memoryFiles.has(String(filePath))),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn((filePath: string) => memoryFiles.get(String(filePath)) ?? "{}"),
  renameSync: vi.fn((from: string, to: string) => {
    memoryFiles.set(String(to), memoryFiles.get(String(from)) ?? "");
    memoryFiles.delete(String(from));
  }),
  statSync: vi.fn(() => ({ size: 0 })),
  unlinkSync: vi.fn((filePath: string) => {
    memoryFiles.delete(String(filePath));
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    memoryFiles.set(String(filePath), String(data));
  }),
}));

vi.mock("@stellar/stellar-sdk", () => ({
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      feeStats: vi.fn(),
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
      transactions: vi.fn(() => ({
        transaction: mockHorizonTransaction,
      })),
    }),
  },
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: vi.fn().mockReturnValue(Buffer.from([0xca, 0xfe, 0xba, 0xbe])),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Operation: { payment: vi.fn() },
  TransactionBuilder: vi.fn(),
}));

vi.mock("@x402/fetch", () => ({
  decodePaymentResponseHeader: mockDecodePaymentResponseHeader,
  wrapFetchWithPayment: vi.fn(() => mockX402Fetch),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
}));

vi.mock("@x402/stellar", () => ({
  createEd25519Signer: vi.fn().mockReturnValue({}),
  ExactStellarScheme: vi.fn(),
}));

vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn() }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import {
  auditBill,
  checkDrugInteractions,
  comparePharmacyPrices,
  fetchAndAuditBill,
  loadSpending,
  resetSpendingTracker,
} from "../tools.ts";

const txHash = "a".repeat(64);
const validLineItems = [
  {
    description: "Office visit",
    cptCode: "99213",
    quantity: 1,
    chargedAmount: 130,
  },
];

beforeEach(() => {
  memoryFiles.clear();
  mockAppendFileSync.mockClear();
  mockDecodePaymentResponseHeader.mockReset();
  mockDecodePaymentResponseHeader.mockReturnValue({ transaction: txHash });
  mockHorizonCall.mockReset();
  mockHorizonCall.mockResolvedValue({ id: txHash });
  mockHorizonTransaction.mockClear();
  mockPlainFetch.mockReset();
  mockX402Fetch.mockReset();
  vi.stubGlobal("fetch", mockPlainFetch);

  resetSpendingTracker();
  mockAppendFileSync.mockClear();
});

function jsonResponse(body: unknown, includePaymentHeader = true): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (includePaymentHeader) {
    headers.set("PAYMENT-RESPONSE", "encoded-payment-response");
  }

  return new Response(JSON.stringify(body), { status: 200, headers });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function serviceFeeTransactions() {
  return mockAppendFileSync.mock.calls
    .filter(([filePath]) => String(filePath).endsWith("transactions.jsonl"))
    .map(([, data]) => JSON.parse(String(data).trim()));
}

describe("x402 service tools", () => {
  it("records service_fee transactions with the configured x402 fee amounts", async () => {
    mockX402Fetch
      .mockResolvedValueOnce(jsonResponse({ protocol: { payTo: "pharmacy-price-api" }, prices: [] }))
      .mockResolvedValueOnce(jsonResponse({ protocol: { payTo: "bill-audit-api" }, lineItems: [] }))
      .mockResolvedValueOnce(jsonResponse({ protocol: { payTo: "drug-interaction-api" }, interactions: [] }));

    await comparePharmacyPrices("Metformin", "10001", "10mg");
    await auditBill(validLineItems);
    await checkDrugInteractions(["Metformin", "Atorvastatin"]);

    const transactions = serviceFeeTransactions();
    expect(transactions.map((tx) => tx.type)).toEqual([
      "service_fee",
      "service_fee",
      "service_fee",
    ]);
    expect(transactions.map((tx) => tx.amount)).toEqual([0.002, 0.01, 0.001]);
    expect(transactions.map((tx) => tx.stellarTxHash)).toEqual([txHash, txHash, txHash]);
    expect(loadSpending().serviceFees).toBeCloseTo(0.013, 6);
    expect(mockHorizonTransaction).toHaveBeenCalledTimes(3);
  });

  it("records undefined stellarTxHash when PAYMENT-RESPONSE is missing", async () => {
    mockX402Fetch.mockResolvedValueOnce(
      jsonResponse({ protocol: { payTo: "pharmacy-price-api" }, prices: [] }, false),
    );

    await comparePharmacyPrices("Metformin");

    const [transaction] = serviceFeeTransactions();
    expect(transaction.amount).toBe(0.002);
    expect(transaction.stellarTxHash).toBeUndefined();
    expect(mockDecodePaymentResponseHeader).not.toHaveBeenCalled();
    expect(mockHorizonTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      "comparePharmacyPrices",
      () => comparePharmacyPrices("Metformin"),
      /Pharmacy API error \(500\): Server exploded/,
    ],
    [
      "auditBill",
      () => auditBill(validLineItems),
      /Bill Audit API is up but failing \(500\).*Server exploded/,
    ],
    [
      "checkDrugInteractions",
      () => checkDrugInteractions(["Metformin", "Atorvastatin"]),
      /Drug Interaction API error \(500\): Server exploded/,
    ],
  ])("surfaces upstream 500 responses for %s with a sanitized body excerpt", async (_name, run, message) => {
    mockX402Fetch.mockResolvedValueOnce(
      errorResponse(500, "<html><body><h1>Server exploded</h1></body></html>"),
    );

    await expect(run()).rejects.toThrow(message);
  });

  it.each([
    [
      "comparePharmacyPrices",
      () => comparePharmacyPrices("Metformin"),
      /Pharmacy API connection refused.*http:\/\/pharmacy\.test/,
    ],
    [
      "auditBill",
      () => auditBill(validLineItems),
      /Bill Audit API connection refused.*http:\/\/bill\.test/,
    ],
    [
      "checkDrugInteractions",
      () => checkDrugInteractions(["Metformin", "Atorvastatin"]),
      /Drug Interaction API connection refused.*http:\/\/drug\.test/,
    ],
  ])("adds the service URL to network errors from %s", async (_name, run, message) => {
    mockX402Fetch.mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );

    await expect(run()).rejects.toThrow(message);
  });

  it("fetchAndAuditBill fetches the sample bill without x402 before auditing with x402", async () => {
    mockPlainFetch.mockResolvedValueOnce(jsonResponse({ lineItems: validLineItems }, false));
    mockX402Fetch.mockResolvedValueOnce(
      jsonResponse({ protocol: { payTo: "bill-audit-api" }, lineItems: [] }),
    );

    await fetchAndAuditBill();

    expect(mockPlainFetch).toHaveBeenCalledWith("http://bill.test/bill/sample");
    expect(mockX402Fetch).toHaveBeenCalledWith(
      "http://bill.test/bill/audit",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(mockPlainFetch.mock.invocationCallOrder[0]).toBeLessThan(
      mockX402Fetch.mock.invocationCallOrder[0],
    );
  });
});
