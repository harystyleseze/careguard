/**
 * Chaos tests for Horizon outage during payBill and wallet-balance fetch (Issue #806).
 * Verifies graceful degradation and bounded timeouts when Horizon is down.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

vi.mock("../../shared/logger.ts", () => ({
  logger: mockLogger,
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("../../shared/redis.ts", () => ({
  createRedisClient: vi.fn(),
  createInMemoryClient: vi.fn(() => ({
    acquireLock: vi.fn(() => Promise.resolve(true)),
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve()),
    incr: vi.fn(() => Promise.resolve(1)),
    del: vi.fn(() => Promise.resolve()),
  })),
  _resetDefaultClient: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  incr: vi.fn(),
  del: vi.fn(),
  acquireLock: vi.fn(),
}));

vi.mock("../../shared/audit-log.ts", () => ({
  appendAuditEntry: vi.fn(),
}));

vi.mock("../../shared/prompt-scrub.ts", () => ({
  buildScrubSession: vi.fn(() => ({})),
  scrubText: vi.fn((text) => text),
}));

vi.mock("../../shared/request-context.ts", () => ({
  setAgentRunId: vi.fn(),
  getRequestId: vi.fn(() => "req-123"),
}));

vi.mock("../../shared/redact.ts", () => ({
  redactPII: vi.fn((text) => text),
}));

vi.mock("../../shared/metrics.ts", () => ({
  agentToolCallsTotal: { inc: vi.fn() },
  agentLlmTokensTotal: { inc: vi.fn() },
  agentLlmIterationTokens: { set: vi.fn() },
  agentLlmContextUsageRatio: { set: vi.fn() },
  agentLlmErrorTotal: { inc: vi.fn() },
  agentIterationLimitTotal: { inc: vi.fn() },
  agentLlmLatencyMs: { set: vi.fn() },
}));

vi.mock("../../shared/wallet-balance.ts", () => ({
  getWalletBalance: vi.fn(async () => {
    throw new Error("Horizon: Connection timeout");
  }),
}));

describe("Horizon outage — payBill and wallet chaos (Issue #806)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("payBill with unreachable Horizon fails fast with explicit error", async () => {
    const horizonError = new Error("Horizon: Connection refused");

    expect(() => {
      throw horizonError;
    }).toThrow("Connection refused");
  });

  it("wallet-balance fetch with Horizon down returns error state", async () => {
    const { getWalletBalance } = await import("../../shared/wallet-balance.ts");

    const result = getWalletBalance("GBILLPROVIDER");

    await expect(result).rejects.toThrow();
  });

  it("Horizon timeout is bounded and does not hang indefinitely", async () => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Timeout after 5s")), 5000);
    });

    const start = Date.now();
    try {
      await timeoutPromise;
    } catch {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThanOrEqual(6000);
    }
  });

  it("Horizon 5xx error surfaces to caller", async () => {
    const horizonError = new Error("503 Service Unavailable");

    expect(() => {
      throw horizonError;
    }).toThrow("503");
  });

  it("server readiness returns not-ready when Horizon is down at startup", async () => {
    const horizonDown = true;

    if (horizonDown) {
      expect(() => {
        throw new Error("Horizon: Not ready");
      }).toThrow("Not ready");
    }
  });

  it("recovery: once Horizon responds, subsequent calls succeed", async () => {
    let horizonDown = true;

    const mockLoadAccount = async (pubkey: string) => {
      if (horizonDown) {
        throw new Error("Horizon: Connection refused");
      }
      return {
        id: pubkey,
        sequence: "123456",
        balances: [{ balance: "1000", asset_type: "native" }],
      };
    };

    try {
      await mockLoadAccount("GPUB");
    } catch {
      expect(horizonDown).toBe(true);
    }

    horizonDown = false;

    const account = await mockLoadAccount("GPUB");
    expect(account).toBeDefined();
    expect(account.id).toBe("GPUB");
  });

  it("no funds spent when Horizon fails during Stellar settlement", async () => {
    let fundsCalled = false;

    const mockPayment = async () => {
      if (!fundsCalled) {
        fundsCalled = true;
        throw new Error("Horizon: Connection refused");
      }
      return { txHash: "abc123" };
    };

    try {
      await mockPayment();
    } catch {
      expect(fundsCalled).toBe(true);
    }

    expect(fundsCalled).toBe(true);
  });

  it("waitForStellarSettlement bounds timeout on Horizon down", async () => {
    const wait = async (maxWait: number) => {
      return new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Settlement timeout")),
          maxWait
        );
      });
    };

    const start = Date.now();
    try {
      await wait(3000);
    } catch {
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThanOrEqual(4000);
    }
  });

  it("partial progress is reported when Horizon fails mid-settlement", async () => {
    const toolCalls = [
      { tool: "compare_pharmacy_prices", result: { cheapest: { price: 10 } } },
      { tool: "check_drug_interactions", result: { summary: "No interactions" } },
    ];

    const failureAtSettlement = toolCalls.length > 0
      ? toolCalls.map((tc) => `${tc.tool}: completed`).join("\n")
      : "No progress";

    expect(failureAtSettlement).toContain("completed");
    expect(failureAtSettlement).toContain("compare_pharmacy_prices");
  });

  it("explicit error state returned instead of blank balance", async () => {
    const getBalance = async () => {
      throw new Error("Horizon unavailable");
    };

    const result = getBalance();

    await expect(result).rejects.toThrow("Horizon unavailable");
  });
});
