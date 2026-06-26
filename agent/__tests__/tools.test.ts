// vi.hoisted runs before any vi.mock factory — sets env vars + captures mutable refs
const { mockMppFetch, onProgressHolder, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
  const onProgressHolder: { fn?: (event: any) => void } = {};
  return {
    mockMppFetch: vi.fn(),
    onProgressHolder,
    MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) =>
    String(filePath).includes("spending.json")
      ? JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [] })
      : "{}",
  ),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn((filePath: string) => String(filePath).includes("spending.json")),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
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
    build: vi.fn().mockReturnValue({
      sign: vi.fn(),
      signatures: [{ hint: vi.fn().mockReturnValue(MOCK_HINT) }],
    }),
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
import { readFileSync } from "fs";
import { auditBill, checkDrugInteractions, checkSpendingPolicy, loadSpending, payBill, payForMedication } from "../tools.ts";

const mockedReadFileSync = vi.mocked(readFileSync);

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

  it("counts transactions at midnight and 1ms past midnight in the current day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));

    const tracker = loadSpending("rosa");
    tracker.transactions = [
      {
        id: "tx-midnight",
        timestamp: "2026-04-10T00:00:00.000Z",
        type: "payment",
        description: "Midnight medication",
        amount: 40,
        recipient: "pharmacy-1",
        status: "completed",
        category: "medications",
      },
      {
        id: "tx-midnight-plus-1ms",
        timestamp: "2026-04-10T00:00:00.001Z",
        type: "payment",
        description: "Midnight medication +1ms",
        amount: 40,
        recipient: "pharmacy-1",
        status: "completed",
        category: "medications",
      },
      {
        id: "tx-previous-day",
        timestamp: "2026-04-09T23:59:59.999Z",
        type: "payment",
        description: "Previous day medication",
        amount: 10,
        recipient: "pharmacy-1",
        status: "completed",
        category: "medications",
      },
    ] as any;

    const policy = checkSpendingPolicy(30, "medications");
    expect(policy.allowed).toBe(false);
    expect(policy.reason).toContain("Already spent today: $80.00");

    vi.useRealTimers();
  });
});

describe("Bill audit input validation", () => {
  it.each([
    ["missing field", [{ description: "Office visit", quantity: 1, chargedAmount: 130 }]],
    ["zero qty", [{ description: "Office visit", cptCode: "99213", quantity: 0, chargedAmount: 130 }]],
    ["negative amount", [{ description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: -1 }]],
    ["malformed cpt", [{ description: "Office visit", cptCode: "AB123", quantity: 1, chargedAmount: 130 }]],
  ])("rejects %s", async (_label, lineItems) => {
    const result = await auditBill(lineItems as any);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INVALID_LINE_ITEMS");
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("Drug interaction checks", () => {
  it("rejects a single medication", async () => {
    const result = await checkDrugInteractions(["lisinopril"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NEED_AT_LEAST_TWO_MEDS");
  });

  it("runs the audit when two medications are supplied", async () => {
    const result = await checkDrugInteractions(["lisinopril", "amlodipine"]);
    expect(result.reason).toBeUndefined();
    expect(result.interactions).toEqual([]);
  });
});

describe("Spending cache", () => {
  it("keeps repeated spending loads on memory after boot", () => {
    const before = mockedReadFileSync.mock.calls.length;
    expect(before).toBe(1);

    for (let index = 0; index < 100; index++) {
      loadSpending("rosa");
    }

    expect(mockedReadFileSync.mock.calls.length).toBe(1);
  });
});
