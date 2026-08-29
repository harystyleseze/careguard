/**
 * Unit tests for agent policy and spending summary helpers (#38).
 */

import { vi } from "vitest";
import { TRANSACTION_CATEGORY } from "../../shared/types.ts";

const { fsState, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  return {
    fsState: {
      files: new Map<string, string>(),
    },
    MOCK_HINT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    const key = String(filePath);
    if (!fsState.files.has(key)) {
      const err: any = new Error(`ENOENT: no such file or directory, open '${key}'`);
      err.code = "ENOENT";
      throw err;
    }
    return fsState.files.get(key)!;
  }),
  writeFileSync: vi.fn((filePath: string, data: string) => {
    fsState.files.set(String(filePath), String(data));
  }),
  appendFileSync: vi.fn((filePath: string, data: string) => {
    const key = String(filePath);
    fsState.files.set(key, (fsState.files.get(key) ?? "") + String(data));
  }),
  existsSync: vi.fn((filePath: string) => fsState.files.has(String(filePath))),
  mkdirSync: vi.fn(),
  renameSync: vi.fn((oldPath: string, newPath: string) => {
    const oldKey = String(oldPath);
    const newKey = String(newPath);
    if (!fsState.files.has(oldKey)) {
      const err: any = new Error(`ENOENT: no such file or directory, rename '${oldKey}' -> '${newKey}'`);
      err.code = "ENOENT";
      throw err;
    }
    fsState.files.set(newKey, fsState.files.get(oldKey)!);
    fsState.files.delete(oldKey);
  }),
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
  stellar: vi.fn().mockReturnValue({}),
}));
vi.mock("mppx/client", () => ({
  Mppx: { create: vi.fn().mockReturnValue({ fetch: vi.fn() }) },
}));
vi.mock("../../shared/audit-log.ts", () => ({ appendAuditEntry: vi.fn() }));
vi.mock("../../shared/notifications.ts", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { beforeEach, describe, expect, it } from "vitest";

const DATA_DIR = new URL("../../data", import.meta.url).pathname;
const ROSA_DIR = `${DATA_DIR}/recipients/rosa`;
const POLICY_FILE = `${ROSA_DIR}/policy.json`;
const SPENDING_FILE = `${ROSA_DIR}/spending.json`;
const SNAPSHOT_FILE = `${ROSA_DIR}/spending.snapshot.json`;
const TOOLS_MODULE = "../tools.ts";

const VALID_POLICY = {
  dailyLimit: 150,
  monthlyLimit: 900,
  medicationMonthlyBudget: 350,
  billMonthlyBudget: 450,
  approvalThreshold: 80,
  holdTimeSeconds: 30,
  toolFees: {
    comparePharmacyPrices: 0.003,
    auditBill: 0.02,
    checkDrugInteractions: 0.002,
  },
  notifications: {
    email: true,
    sms: false,
    emailAddress: "caregiver@example.com",
  },
};

function mixedSpending() {
  return {
    medications: 40,
    bills: 25.5,
    serviceFees: 0.0134,
    transactions: [
      {
        id: "tx-med",
        timestamp: "2026-06-01T10:00:00.000Z",
        type: "medication" as const,
        description: "Atorvastatin",
        amount: 40,
        recipient: "pharmacy-1",
        status: "completed" as const,
        category: TRANSACTION_CATEGORY.MEDICATIONS,
      },
      {
        id: "tx-bill",
        timestamp: "2026-06-02T10:00:00.000Z",
        type: "bill" as const,
        description: "Lab copay",
        amount: 25.5,
        recipient: "lab-1",
        status: "completed" as const,
        category: TRANSACTION_CATEGORY.BILLS,
      },
      {
        id: "tx-fee",
        timestamp: "2026-06-03T10:00:00.000Z",
        type: "service_fee" as const,
        description: "x402 query",
        amount: 0.0134,
        recipient: "service",
        status: "completed" as const,
        category: TRANSACTION_CATEGORY.SERVICE_FEES,
      },
    ],
  };
}

async function importTools(): Promise<any> {
  return import(TOOLS_MODULE);
}

beforeEach(() => {
  fsState.files.clear();
});

describe("agent policy and summary helpers (#38)", () => {
  it("setSpendingPolicy persists a valid policy to policy.json", async () => {
    vi.resetModules();
    const tools = await importTools();

    tools.setSpendingPolicy(VALID_POLICY);

    const persisted = JSON.parse(fsState.files.get(POLICY_FILE)!);
    expect(persisted).toMatchObject(VALID_POLICY);
    expect(persisted.notifications).toEqual({
      email: true,
      sms: false,
      emailAddress: "caregiver@example.com",
    });
  });

  it("setSpendingPolicy throws for invalid budget totals without writing policy.json", async () => {
    vi.resetModules();
    const tools = await importTools();
    const before = fsState.files.get(POLICY_FILE);

    expect(() =>
      tools.setSpendingPolicy({
        dailyLimit: 50,
        monthlyLimit: 100,
        medicationMonthlyBudget: 80,
        billMonthlyBudget: 50,
        approvalThreshold: 25,
      }),
    ).toThrow(/cannot exceed monthlyLimit/);
    expect(fsState.files.get(POLICY_FILE)).toBe(before);
  });

  it("getSpendingSummary returns correct totals after mixed transaction types", async () => {
    vi.resetModules();
    const tools = await importTools();
    tools.setSpendingPolicy(VALID_POLICY);
    const tracker = tools.loadSpending("rosa");
    Object.assign(tracker, mixedSpending());
    tools.saveSpending(tracker, "rosa");

    const summary = tools.getSpendingSummary();

    expect(summary.spending).toEqual({
      medications: 40,
      bills: 25.5,
      serviceFees: 0.0134,
      total: 65.51,
    });
    expect(summary.budgetRemaining).toEqual({
      medications: 310,
      bills: 424.5,
    });
    expect(summary.transactionCount).toBe(3);
    expect(summary.recentTransactions.map((tx: any) => tx.id)).toEqual([
      "tx-med",
      "tx-bill",
      "tx-fee",
    ]);
  });

  it("resetSpendingTracker zeroes all totals and persists the empty tracker", async () => {
    vi.resetModules();
    const tools = await importTools();
    const tracker = tools.loadSpending("rosa");
    Object.assign(tracker, mixedSpending());
    tools.saveSpending(tracker, "rosa");

    tools.resetSpendingTracker("rosa");

    expect(tools.getSpendingSummary().spending).toEqual({
      medications: 0,
      bills: 0,
      serviceFees: 0,
      total: 0,
    });
    expect(tools.getSpendingSummary().transactionCount).toBe(0);
    expect(JSON.parse(fsState.files.get(SPENDING_FILE)!)).toMatchObject({
      medications: 0,
      bills: 0,
      serviceFees: 0,
      transactions: [],
    });
    expect(JSON.parse(fsState.files.get(SNAPSHOT_FILE)!)).toMatchObject({
      medications: 0,
      bills: 0,
      serviceFees: 0,
      transactions: [],
      _snapshotTxCount: 0,
    });
  });

  it("retains policy and spending values after a module reload", async () => {
    vi.resetModules();
    const before = await importTools();
    before.setSpendingPolicy(VALID_POLICY);
    const tracker = before.loadSpending("rosa");
    Object.assign(tracker, mixedSpending());
    before.saveSpending(tracker, "rosa");

    vi.resetModules();
    const after = await importTools();
    const summary = after.getSpendingSummary();

    expect(summary.policy.dailyLimit).toBe(150);
    expect(summary.policy.approvalThreshold).toBe(80);
    expect(summary.spending.medications).toBe(40);
    expect(summary.spending.bills).toBe(25.5);
    expect(summary.spending.serviceFees).toBe(0.0134);
    expect(summary.transactionCount).toBe(3);
  });
});
