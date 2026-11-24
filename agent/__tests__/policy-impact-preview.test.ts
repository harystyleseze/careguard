import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const tempBase = process.env.TEMP || process.env.TMP || "/tmp";
  process.env.DATA_DIR = `${tempBase.replace(/\\/g, "/")}/careguard-policy-preview-${Date.now()}`;
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  process.env.SPENDING_TIMEZONE = "UTC";
});

// Keep the payment stack out of this pure policy test (same mocks as
// timezone-policy.test.ts).
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GPUB123",
      sign: vi.fn(),
      signatureHint: vi.fn().mockReturnValue(Buffer.from([0xca, 0xfe, 0xba, 0xbe])),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: { Server: vi.fn().mockReturnValue({ loadAccount: vi.fn(), submitTransaction: vi.fn() }) },
}));
vi.mock("@stellar/mpp/charge/client", () => ({ stellar: vi.fn().mockReturnValue({}) }));
vi.mock("mppx/client", () => ({ Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) } }));
vi.mock("@x402/stellar", () => ({ createEd25519Signer: vi.fn().mockReturnValue({}), ExactStellarScheme: vi.fn() }));
vi.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: vi.fn().mockReturnValue(vi.fn()),
  x402Client: vi.fn().mockReturnValue({ register: vi.fn().mockReturnThis() }),
}));
vi.mock("../../shared/notifications.ts", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));

import {
  evaluateSpendingPolicy,
  simulatePolicyImpact,
} from "../tools.ts";
import type { SpendingPolicy, Transaction } from "../../shared/types.ts";

const POLICY: SpendingPolicy = {
  dailyLimit: 100,
  monthlyLimit: 1000,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
  timezone: "UTC",
};

function tx(
  id: string,
  timestamp: string,
  amount: number,
  category: Transaction["category"] = "medications",
  status: Transaction["status"] = "completed",
): Transaction {
  return {
    id,
    timestamp,
    type: category === "bills" ? "bill" : category === "medications" ? "medication" : "service_fee",
    description: `payment ${id}`,
    amount,
    recipient: "pharmacy",
    status,
    category,
  };
}

describe("evaluateSpendingPolicy (#1238)", () => {
  const empty = { medications: 0, bills: 0, serviceFees: 0, transactions: [] };

  it("applies the same rules check_spending_policy uses", () => {
    expect(evaluateSpendingPolicy(POLICY, empty, 50, "medications").allowed).toBe(true);
    expect(evaluateSpendingPolicy(POLICY, empty, 80, "medications").requiresApproval).toBe(true);
    expect(evaluateSpendingPolicy(POLICY, empty, 150, "medications").allowed).toBe(false);
    expect(
      evaluateSpendingPolicy(POLICY, { ...empty, medications: 290 }, 20, "medications").allowed,
    ).toBe(false);
  });

  it("evaluates the daily limit for the day of `now`, not today", () => {
    const state = {
      ...empty,
      medications: 60,
      transactions: [tx("a", "2026-03-10T09:00:00.000Z", 60)],
    };
    const sameDay = new Date("2026-03-10T15:00:00.000Z");
    const nextDay = new Date("2026-03-11T15:00:00.000Z");
    expect(evaluateSpendingPolicy(POLICY, state, 50, "medications", sameDay).allowed).toBe(false);
    expect(evaluateSpendingPolicy(POLICY, state, 50, "medications", nextDay).allowed).toBe(true);
  });
});

describe("simulatePolicyImpact (#1238)", () => {
  const history = [
    tx("1", "2026-03-01T10:00:00.000Z", 40),
    tx("2", "2026-03-02T10:00:00.000Z", 60),
    tx("3", "2026-03-03T10:00:00.000Z", 90, "bills"),
    tx("fee", "2026-03-03T11:00:00.000Z", 0.01, "service_fees"),
    tx("4", "2026-03-04T10:00:00.000Z", 30),
    tx("blocked", "2026-03-05T10:00:00.000Z", 500, "medications", "blocked"),
  ];

  it("reports no differences when the policy is unchanged", () => {
    const impact = simulatePolicyImpact(POLICY, POLICY, history);
    expect(impact.evaluated).toBe(4);
    expect(impact.newlyBlocked).toBe(0);
    expect(impact.newlyAllowed).toBe(0);
    expect(impact.entries.every((e) => !e.changed)).toBe(true);
  });

  it("counts payments a lower daily limit would have blocked", () => {
    const impact = simulatePolicyImpact(POLICY, { ...POLICY, dailyLimit: 50 }, history);
    // $60 and $90 exceed a $50 daily limit; $40 and $30 do not.
    expect(impact.newlyBlocked).toBe(2);
    expect(impact.entries.filter((e) => e.after === "blocked").map((e) => e.id).sort()).toEqual(["2", "3"]);
  });

  it("accounts for month-to-date spend preceding each payment", () => {
    // Meds budget $100: $40 + $60 fit, the later $30 pushes past it.
    const impact = simulatePolicyImpact(POLICY, { ...POLICY, medicationMonthlyBudget: 100 }, history);
    expect(impact.newlyBlocked).toBe(1);
    expect(impact.entries.find((e) => e.changed)?.id).toBe("4");
  });

  it("flags approval-requirement changes separately from blocks", () => {
    const impact = simulatePolicyImpact(POLICY, { ...POLICY, approvalThreshold: 35 }, history);
    expect(impact.newlyBlocked).toBe(0);
    // $40 and $60 now need approval ($90 already did; $30 still doesn't).
    expect(impact.approvalChanged).toBe(2);
  });

  it("counts payments a looser policy would have allowed", () => {
    const strict = { ...POLICY, dailyLimit: 50 };
    const impact = simulatePolicyImpact(strict, POLICY, history);
    expect(impact.newlyAllowed).toBe(2);
  });

  it("only replays the most recent `limit` payments, newest first", () => {
    const impact = simulatePolicyImpact(POLICY, POLICY, history, 2);
    expect(impact.entries.map((e) => e.id)).toEqual(["4", "3"]);
  });

  it("does not let spend from an earlier month count against the budget", () => {
    const crossMonth = [
      tx("feb", "2026-02-27T10:00:00.000Z", 90),
      tx("mar", "2026-03-01T10:00:00.000Z", 90),
    ];
    const impact = simulatePolicyImpact(POLICY, { ...POLICY, medicationMonthlyBudget: 100 }, crossMonth);
    expect(impact.newlyBlocked).toBe(0);
  });
});
