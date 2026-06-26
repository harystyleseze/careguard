import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDecode } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  return { mockDecode: vi.fn() };
});

vi.mock("@x402/fetch", () => ({
  decodePaymentResponseHeader: mockDecode,
  wrapFetchWithPayment: vi.fn((fetchImpl) => fetchImpl),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockReturnValue("{}"),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
}));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUB123", sign: vi.fn(), signatureHint: vi.fn() }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn() },
}));
vi.mock("@x402/stellar", () => ({ createEd25519Signer: vi.fn(), ExactStellarScheme: vi.fn() }));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn() }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { extractX402TxHash } from "../tools.ts";

function makeResponse(headerValue: string | null): Response {
  const headers = new Headers();
  if (headerValue !== null) {
    headers.set("PAYMENT-RESPONSE", headerValue);
  }
  return { headers } as Response;
}

describe("extractX402TxHash", () => {
  beforeEach(() => {
    mockDecode.mockReset();
  });

  it("should extract tx hash from PAYMENT-RESPONSE header (base64 of SettleResponse)", () => {
    mockDecode.mockReturnValue({ transaction: "a".repeat(64) });
    const result = extractX402TxHash(makeResponse("dGVzdC1iYXNlNjQ="));
    expect(result).toBe("a".repeat(64));
    expect(mockDecode).toHaveBeenCalledWith("dGVzdC1iYXNlNjQ=");
  });

  it("should handle payment-response (lowercase) header", () => {
    mockDecode.mockReturnValue({ transaction: "b".repeat(64) });
    const headers = new Headers();
    headers.set("payment-response", "bXktcGF5bG9hZA==");
    const result = extractX402TxHash({ headers } as Response);
    expect(result).toBe("b".repeat(64));
  });

  it("should handle X-PAYMENT-RESPONSE (alt form) header", () => {
    mockDecode.mockReturnValue({ transaction: "c".repeat(64) });
    const headers = new Headers();
    headers.set("X-PAYMENT-RESPONSE", "YWx0LWZvcm0=");
    const result = extractX402TxHash({ headers } as Response);
    expect(result).toBe("c".repeat(64));
  });

  it("should return undefined when no header is present", () => {
    const headers = new Headers();
    const result = extractX402TxHash({ headers } as Response);
    expect(result).toBeUndefined();
  });

  it("should return undefined when decoded has no transaction field", () => {
    mockDecode.mockReturnValue({});
    const result = extractX402TxHash(makeResponse("dGVzdA=="));
    expect(result).toBeUndefined();
  });

  it("should return undefined when decode throws and header is not 64-char hex", () => {
    mockDecode.mockImplementation(() => { throw new Error("decode failed"); });
    const result = extractX402TxHash(makeResponse("short"));
    expect(result).toBeUndefined();
  });

  it("should fall back to raw header when decode throws and header is 64-char hex", () => {
    mockDecode.mockImplementation(() => { throw new Error("decode failed"); });
    const hash = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const result = extractX402TxHash(makeResponse(hash));
    expect(result).toBe(hash);
  });

  it("should return undefined for 63-char hex header when decode throws", () => {
    mockDecode.mockImplementation(() => { throw new Error("decode failed"); });
    const result = extractX402TxHash(makeResponse("a".repeat(63)));
    expect(result).toBeUndefined();
  });

  it("should return undefined for 65-char hex header when decode throws", () => {
    mockDecode.mockImplementation(() => { throw new Error("decode failed"); });
    const result = extractX402TxHash(makeResponse("a".repeat(65)));
    expect(result).toBeUndefined();
  });

  it("should return undefined on malformed base64 in decode", () => {
    mockDecode.mockImplementation(() => { throw new Error("malformed base64"); });
    const result = extractX402TxHash(makeResponse("!!!invalid-base64!!!"));
    expect(result).toBeUndefined();
  });
});
