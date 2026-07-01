// vi.hoisted must set env vars and define mocks before any vi.mock factory executes
const { mockLoadAccount } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
  process.env.USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  return { mockLoadAccount: vi.fn() };
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
  Keypair: { fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GPUBAGENT", sign: vi.fn(), signatureHint: vi.fn().mockReturnValue(Buffer.from([0xca, 0xfe, 0xba, 0xbe])) }) },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn().mockReturnValue({ addOperation: vi.fn().mockReturnThis(), setTimeout: vi.fn().mockReturnThis(), build: vi.fn().mockReturnValue({ sign: vi.fn(), signatures: [] }) }),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: mockLoadAccount, submitTransaction: vi.fn(), feeStats: vi.fn() }) },
}));
vi.mock("@x402/stellar", () => ({ createEd25519Signer: vi.fn().mockReturnValue({}), ExactStellarScheme: vi.fn() }));
vi.mock("@x402/fetch", () => ({ wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()), x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }), decodePaymentResponseHeader: vi.fn() }));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getWalletBalance } from "../tools.ts";

/**
 * Vitest: USDC issuer filtering (Issue #198)
 *
 * A Stellar wallet can hold multiple tokens named "USDC" from different issuers.
 * getWalletBalance() must select only the canonical Circle USDC issuer.
 */

const CANONICAL_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const PHISHING_ISSUER = "GPHISHINGBADACTOR111111111111111111111111111111111111111111";

beforeEach(() => {
  mockLoadAccount.mockClear();
});

describe("getWalletBalance — USDC issuer filtering (Issue #198)", () => {
  it("selects only the canonical USDC issuer when two USDC entries are present", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: CANONICAL_ISSUER, balance: "42.50" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: PHISHING_ISSUER, balance: "1000.00" },
        { asset_type: "native", balance: "10.00" },
      ],
    });

    const result = await getWalletBalance();
    expect(result.balances.usdc).toBe("42.50");
    expect(result.usdcTrustlineMissing).toBe(false);
  });

  it("returns usdcTrustlineMissing: true when only a phishing USDC is held", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: PHISHING_ISSUER, balance: "999.00" },
        { asset_type: "native", balance: "5.00" },
      ],
    });

    const result = await getWalletBalance();
    expect(result.balances.usdc).toBe("0.00");
    expect(result.usdcTrustlineMissing).toBe(true);
  });

  it("returns usdcTrustlineMissing: true when no USDC trustline exists at all", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "100.00" },
      ],
    });

    const result = await getWalletBalance();
    expect(result.balances.usdc).toBe("0.00");
    expect(result.usdcTrustlineMissing).toBe(true);
  });

  it("does not mistake XLM native balance for USDC", async () => {
    mockLoadAccount.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "500.00" },
      ],
    });

    const result = await getWalletBalance();
    expect(result.balances.xlm).toBe("500.00");
    expect(result.balances.usdc).toBe("0.00");
    expect(result.usdcTrustlineMissing).toBe(true);
  });
});
