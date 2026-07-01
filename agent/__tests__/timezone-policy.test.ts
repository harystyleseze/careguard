/**
 * Vitest: per-policy timezone daily-limit check (Issue #207).
 *
 * Verifies that checkSpendingPolicy uses policy.timezone (not the global
 * SPENDING_TIMEZONE env var) when determining whether a transaction timestamp
 * falls within "today" in the caregiver's local timezone.
 *
 * Acceptance criterion:
 *   An 11 pm Phoenix transaction shows up on today's local day, not tomorrow's
 *   UTC day.
 */

const { MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  // Global env is UTC to clearly distinguish it from the per-policy Phoenix tz
  process.env.SPENDING_TIMEZONE = "UTC";
  return { MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    const key = String(filePath);
    if (key.includes("spending.snapshot.json")) {
      return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [], _snapshotTxCount: 0 });
    }
    if (key.includes("spending.json")) {
      return JSON.stringify({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
    }
    return "{}";
  }),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn((filePath: string) => {
    const key = String(filePath);
    return key.includes("spending.snapshot.json") || key.includes("spending.json");
  }),
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
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));
vi.mock("../../shared/audit-log.ts", () => ({
  appendAuditEntry: vi.fn(),
  auditRouter: () => (req: any, res: any, next: any) => next(),
}));
vi.mock("../../shared/notifications.ts", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, vi, afterEach } from "vitest";
import { TRANSACTION_CATEGORY } from "../../shared/types.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("Per-policy timezone daily-limit check (Issue #207)", () => {
  it("11 pm Phoenix transaction counts as today in Phoenix, not tomorrow in UTC", async () => {
    vi.resetModules();
    // Re-apply env BEFORE re-importing so the module sees it
    process.env.SPENDING_TIMEZONE = "UTC";
    const tools = await import("../tools.ts");

    // Phoenix is UTC-7 (MST, no DST).
    // 2024-01-15T06:00:00Z = 2024-01-14 11:00 pm in Phoenix (23:00 Jan 14).
    // In UTC that's already 2024-01-15 — so UTC-only code would call it Jan 15.
    // The policy has timezone=America/Phoenix, so it should read as Jan 14.
    const phoenixElevenPm = "2024-01-15T06:00:00.000Z";

    // Fix "now" to 2024-01-14 in Phoenix (= 2024-01-14T07:01:00Z, which is
    // 00:01 on Jan 14 UTC — still Jan 14 in Phoenix at 12:01 am MST wait,
    // let me use a clearer anchor:
    //   "now" = 2024-01-14T22:00:00Z = 2024-01-14 15:00 MST (3 pm Jan 14)
    //   The 11 pm tx is 2024-01-15T06:00:00Z = Jan 14 23:00 MST — same local day.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-14T22:00:00.000Z")); // 3 pm Phoenix Jan 14

    const tracker = tools.loadSpending("rosa");
    // Inject the 11pm Phoenix transaction directly into the in-memory tracker
    tracker.transactions = [
      {
        id: "tx-phoenix-11pm",
        timestamp: phoenixElevenPm,
        type: "medication" as const,
        description: "Late-night medication",
        amount: 40,
        recipient: "pharm-1",
        status: "completed" as const,
        category: TRANSACTION_CATEGORY.MEDICATIONS,
      },
    ] as any;

    // Set a policy with Phoenix timezone, daily limit $100, meds budget $300
    tools.setSpendingPolicy({
      dailyLimit: 100,
      monthlyLimit: 800,
      medicationMonthlyBudget: 300,
      billMonthlyBudget: 500,
      approvalThreshold: 75,
      timezone: "America/Phoenix",
    });

    // The 11pm Phoenix transaction ($40) + new $70 = $110 > daily $100 → blocked
    const result = tools.checkSpendingPolicy(70, "medications");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("daily limit");
    // Confirm spent-today reflects the Phoenix-local tx
    expect(result.reason).toContain("Already spent today: $40.00");
  });

  it("same 11pm Phoenix timestamp is NOT counted as today when policy timezone is UTC", async () => {
    vi.resetModules();
    process.env.SPENDING_TIMEZONE = "UTC";
    const tools = await import("../tools.ts");

    const phoenixElevenPm = "2024-01-15T06:00:00.000Z"; // Jan 15 in UTC

    // "now" in UTC is Jan 14 22:00Z — so today in UTC is Jan 14.
    // The tx timestamp is Jan 15 in UTC → NOT today → should not be counted.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-14T22:00:00.000Z"));

    const tracker = tools.loadSpending("rosa");
    tracker.transactions = [
      {
        id: "tx-phoenix-11pm-utc",
        timestamp: phoenixElevenPm,
        type: "medication" as const,
        description: "Late-night medication",
        amount: 40,
        recipient: "pharm-1",
        status: "completed" as const,
        category: TRANSACTION_CATEGORY.MEDICATIONS,
      },
    ] as any;

    // Policy WITHOUT timezone → falls back to SPENDING_TIMEZONE=UTC
    tools.setSpendingPolicy({
      dailyLimit: 100,
      monthlyLimit: 800,
      medicationMonthlyBudget: 300,
      billMonthlyBudget: 500,
      approvalThreshold: 75,
    });

    // In UTC, the Jan 15 tx is tomorrow, so today's total = $0.
    // $70 < $100 daily limit → should be allowed.
    const result = tools.checkSpendingPolicy(70, "medications");
    expect(result.allowed).toBe(true);
  });
});
