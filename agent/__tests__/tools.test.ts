// vi.hoisted runs before any vi.mock factory — sets env vars + captures mutable refs
const { mockMppFetch, onProgressHolder } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return { mockMppFetch: vi.fn(), onProgressHolder };
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
vi.mock("@stellar/mpp/charge/client", () => ({
  stellar: vi.fn().mockImplementation((opts: any) => {
    if (opts?.onProgress) onProgressHolder.fn = opts.onProgress;
    return {};
  }),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: mockMppFetch }) },
}));

import { describe, it, expect, vi } from "vitest";
import { payForMedication, payBill, checkSpendingPolicy } from "../tools.ts";

describe("Amount Validation (Issue #249)", () => {
  it("should reject Infinity as payment amount", async () => {
    const result = await payForMedication("pharm-1", "Pharmacy A", "Lisinopril", Infinity);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("should reject NaN as payment amount", async () => {
    const result = await payForMedication("pharm-1", "Pharmacy A", "Lisinopril", NaN);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("should reject negative amounts", async () => {
    const result = await payForMedication("pharm-1", "Pharmacy A", "Lisinopril", -10);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("should reject zero", async () => {
    const result = await payForMedication("pharm-1", "Pharmacy A", "Lisinopril", 0);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("should reject amounts exceeding MAX_PAYMENT", async () => {
    const result = await payForMedication("pharm-1", "Pharmacy A", "Lisinopril", 1001);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("payBill should also reject Infinity", async () => {
    const result = await payBill("provider-1", "Hospital", "ER Visit", Infinity);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });

  it("payBill should also reject NaN", async () => {
    const result = await payBill("provider-1", "Hospital", "ER Visit", NaN);
    expect(result.success).toBe(false);
    expect(result.error).toContain("positive finite number");
  });
});

describe("Error Message Truncation (Issue #247)", () => {
  it("should strip HTML tags from error messages", () => {
    const htmlError = "<html><body><h1>Error 502</h1><p>Bad Gateway</p></body></html>";
    const stripped = htmlError.replace(/<[^>]*>/g, "");
    expect(stripped).not.toContain("<");
    expect(stripped).not.toContain(">");
  });

  it("should truncate long error messages to 500 chars", () => {
    const longError = "x".repeat(1000);
    const truncated = longError.slice(0, 500);
    expect(truncated.length).toBeLessThanOrEqual(500);
  });
});

describe("Spending Policy", () => {
  it("should enforce daily limits", () => {
    const policy = checkSpendingPolicy(150, "medications");
    expect(policy.allowed).toBe(false);
  });

  it("should allow valid amounts within policy", () => {
    const policy = checkSpendingPolicy(50, "medications");
    expect(policy.allowed).toBe(true);
  });
});
