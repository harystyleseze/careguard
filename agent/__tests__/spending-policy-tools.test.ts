import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSACTION_CATEGORY, type Transaction } from "../../shared/types.ts";

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

const DATA_DIR = new URL("../../data", import.meta.url).pathname;
const RECIPIENT_DIR = `${DATA_DIR}/recipients/rosa`;
const POLICY_FILE = `${RECIPIENT_DIR}/policy.json`;
const SPENDING_FILE = `${RECIPIENT_DIR}/spending.json`;
const SNAPSHOT_FILE = `${RECIPIENT_DIR}/spending.snapshot.json`;

const BASE_POLICY = {
  dailyLimit: 200,
  monthlyLimit: 1000,
  medicationMonthlyBudget: 400,
  billMonthlyBudget: 500,
  approvalThreshold: 90,
};

function tx(id: string, category: Transaction["category"], amount: number): Transaction {
  const type =
    category === TRANSACTION_CATEGORY.MEDICATIONS
      ? "medication"
      : category === TRANSACTION_CATEGORY.BILLS
        ? "bill"
        : "service_fee";

  return {
    id,
    timestamp: "2026-06-26T12:00:00.000Z",
    type,
    description: `${category} ${id}`,
    amount,
    recipient: "care-provider",
    status: "completed",
    category,
  };
}

function tracker() {
  return {
    medications: 42.3,
    bills: 80.55,
    serviceFees: 0.0123,
    transactions: [
      tx("tx-med", TRANSACTION_CATEGORY.MEDICATIONS, 42.3),
      tx("tx-bill", TRANSACTION_CATEGORY.BILLS, 80.55),
      tx("tx-fee", TRANSACTION_CATEGORY.SERVICE_FEES, 0.0123),
    ],
  };
}

function seedSpending(data = tracker()) {
  fsState.files.set(SPENDING_FILE, JSON.stringify(data, null, 2));
}

beforeEach(() => {
  fsState.files.clear();
  vi.clearAllMocks();
});

describe("spending policy tools (#38)", () => {
  it("setSpendingPolicy persists a valid payload to policy.json", async () => {
    vi.resetModules();
    const tools = await import("../tools.ts");

    tools.setSpendingPolicy({
      ...BASE_POLICY,
      notifications: { email: true, sms: false, emailAddress: "caregiver@example.com" },
    });

    expect(fsState.files.has(POLICY_FILE)).toBe(true);
    const persisted = JSON.parse(fsState.files.get(POLICY_FILE)!);
    expect(persisted).toMatchObject({
      ...BASE_POLICY,
      holdTimeSeconds: 0,
      notifications: { email: true, sms: false, emailAddress: "caregiver@example.com" },
    });
    expect(persisted.toolFees).toMatchObject({
      comparePharmacyPrices: 0.002,
      auditBill: 0.01,
      checkDrugInteractions: 0.001,
    });
  });

  it("setSpendingPolicy throws for an invalid payload", async () => {
    vi.resetModules();
    const tools = await import("../tools.ts");

    expect(() =>
      tools.setSpendingPolicy({
        dailyLimit: 100,
        monthlyLimit: 100,
        medicationMonthlyBudget: 80,
        billMonthlyBudget: 40,
        approvalThreshold: 50,
      }),
    ).toThrow(/medicationMonthlyBudget \+ billMonthlyBudget cannot exceed monthlyLimit/);
  });

  it("getSpendingSummary returns totals for mixed transaction types", async () => {
    seedSpending();
    vi.resetModules();
    const tools = await import("../tools.ts");

    const summary = tools.getSpendingSummary();

    expect(summary.spending).toEqual({
      medications: 42.3,
      bills: 80.55,
      serviceFees: 0.0123,
      total: 122.86,
    });
    expect(summary.budgetRemaining).toEqual({ medications: 257.7, bills: 419.45 });
    expect(summary.transactionCount).toBe(3);
    expect(summary.recentTransactions.map((item: Transaction) => item.category)).toEqual([
      TRANSACTION_CATEGORY.MEDICATIONS,
      TRANSACTION_CATEGORY.BILLS,
      TRANSACTION_CATEGORY.SERVICE_FEES,
    ]);
  });

  it("resetSpendingTracker zeroes everything and persists the empty tracker", async () => {
    seedSpending();
    vi.resetModules();
    const tools = await import("../tools.ts");

    tools.resetSpendingTracker();

    const summary = tools.getSpendingSummary();
    expect(summary.spending).toEqual({ medications: 0, bills: 0, serviceFees: 0, total: 0 });
    expect(summary.transactionCount).toBe(0);

    const spending = JSON.parse(fsState.files.get(SPENDING_FILE)!);
    const snapshot = JSON.parse(fsState.files.get(SNAPSHOT_FILE)!);
    expect(spending).toMatchObject({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
    expect(snapshot).toMatchObject({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
  });

  it("retains spending and policy after a module reload", async () => {
    vi.resetModules();
    const before = await import("../tools.ts");

    before.setSpendingPolicy({ ...BASE_POLICY, dailyLimit: 275, approvalThreshold: 125 });
    before.saveSpending(tracker());

    vi.resetModules();
    const after = await import("../tools.ts");
    const summary = after.getSpendingSummary();

    expect(summary.policy.dailyLimit).toBe(275);
    expect(summary.policy.approvalThreshold).toBe(125);
    expect(summary.spending.medications).toBe(42.3);
    expect(summary.spending.bills).toBe(80.55);
    expect(summary.spending.serviceFees).toBe(0.0123);
    expect(summary.transactionCount).toBe(3);
  });
});
