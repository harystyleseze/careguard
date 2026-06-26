// Issue #44: spending tracker + policy persistence must survive a process
// restart. We simulate a "restart" by calling vi.resetModules() and
// re-importing tools.ts, which re-runs its module-level `let spendingTracker
// = loadSpending()` / `let currentPolicy = loadPolicy()` initializers — the
// same code path a real process restart exercises. The fake fs below is a
// plain Map kept alive via vi.hoisted() so data written by one "process"
// is still there when the next "process" boots and reads it back.
import { vi } from "vitest";
import { TRANSACTION_CATEGORY } from "../../shared/types.ts";

const { fsState, MOCK_HINT } = vi.hoisted(() => {
  process.env.AGENT_SECRET_KEY = "SBWWZYCAFDDJXNRRMKSFNRB6OTVZHTCMPUCVZ4FBZLSPHFKHYLPRTJCD";
  process.env.MOCK_NETWORK = "1";
  return {
    fsState: {
      files: new Map<string, string>(),
      readOnlyPaths: new Set<string>(),
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
    const key = String(filePath);
    for (const blocked of fsState.readOnlyPaths) {
      if (key.includes(blocked)) {
        const err: any = new Error(`EACCES: permission denied, open '${key}'`);
        err.code = "EACCES";
        throw err;
      }
    }
    fsState.files.set(key, String(data));
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
// Persistence behavior is the thing under test — audit logging and
// notifications are unrelated collaborators, so they're stubbed out.
vi.mock("../../shared/audit-log.ts", () => ({ appendAuditEntry: vi.fn() }));
vi.mock("../../shared/notifications.ts", () => ({ notify: vi.fn().mockResolvedValue(undefined) }));
// Spying directly on the real pino instance is unreliable, so mock the
// logger module the same way shared/__tests__/request-logger.test.ts does.
const warnSpy = vi.hoisted(() => vi.fn());
vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: warnSpy, error: vi.fn(), debug: vi.fn() },
}));

import { describe, it, expect, beforeEach } from "vitest";

// Mirrors the DATA_DIR computation in agent/tools.ts so the fake fs paths
// we seed/inspect line up regardless of where the repo is checked out.
const DATA_DIR = new URL("../../data", import.meta.url).pathname;

function freshTracker(transactionCount: number) {
  return {
    medications: 30,
    bills: 20,
    serviceFees: 0,
    transactions: Array.from({ length: transactionCount }, (_, i) => ({
      id: `tx-${i + 1}`,
      timestamp: new Date().toISOString(),
      type: "medication" as const,
      description: `Medication ${i + 1}`,
      amount: 10,
      recipient: "pharm-1",
      status: "completed" as const,
      category: TRANSACTION_CATEGORY.MEDICATIONS,
    })),
  };
}

beforeEach(() => {
  fsState.files.clear();
  fsState.readOnlyPaths.clear();
  warnSpy.mockClear();
});

describe("Spending tracker persistence across restart (#44)", () => {
  it("survives a restart: 3 transactions written before stop are visible after restart", async () => {
    vi.resetModules();
    const before = await import("../tools.ts");
    before.saveSpending(freshTracker(3));

    // --- simulate process restart ---
    vi.resetModules();
    const after = await import("../tools.ts");
    const summary = after.getSpendingSummary();

    expect(summary.transactionCount).toBe(3);
    expect(summary.recentTransactions).toHaveLength(3);
    expect(summary.spending.medications).toBe(30);
    expect(summary.spending.bills).toBe(20);
  });

  it("survives a restart: an updated policy is read back after stop/start", async () => {
    vi.resetModules();
    const before = await import("../tools.ts");
    before.setSpendingPolicy({
      dailyLimit: 123,
      monthlyLimit: 500,
      medicationMonthlyBudget: 200,
      billMonthlyBudget: 300,
      approvalThreshold: 90,
    });

    // --- simulate process restart ---
    vi.resetModules();
    const after = await import("../tools.ts");
    const summary = after.getSpendingSummary();

    expect(summary.policy.dailyLimit).toBe(123);
    expect(summary.policy.monthlyLimit).toBe(500);
    expect(summary.policy.approvalThreshold).toBe(90);
  });
});

describe("Corrupted data falls back to defaults without throwing (#44)", () => {
  it("loadSpending falls back to an empty tracker and logs a warning on malformed JSON", async () => {
    vi.resetModules();
    const tools = await import("../tools.ts");

    fsState.files.set(
      `${DATA_DIR}/recipients/corrupt-recipient/spending.json`,
      "{not valid json",
    );

    let result;
    expect(() => {
      result = tools.loadSpending("corrupt-recipient");
    }).not.toThrow();

    expect(result).toEqual({ medications: 0, bills: 0, serviceFees: 0, transactions: [] });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("a corrupt policy.json on disk does not throw and yields the default policy", async () => {
    vi.resetModules();
    const tools = await import("../tools.ts");

    fsState.files.set(
      `${DATA_DIR}/recipients/rosa/policy.json`,
      "{not valid json",
    );

    let summary;
    expect(() => {
      summary = tools.getSpendingSummary();
    }).not.toThrow();

    expect(summary!.policy.dailyLimit).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("Permission errors produce a clean error with no partial writes (#44)", () => {
  it("saveSpending throws cleanly and never creates the target file when the dir is read-only", async () => {
    vi.resetModules();
    const tools = await import("../tools.ts");

    fsState.readOnlyPaths.add("readonly-recipient");

    expect(() => tools.saveSpending(freshTracker(1), "readonly-recipient")).toThrow(
      /EACCES/,
    );

    const wroteAnything = [...fsState.files.keys()].some((key) =>
      key.includes("readonly-recipient"),
    );
    expect(wroteAnything).toBe(false);
  });
});
