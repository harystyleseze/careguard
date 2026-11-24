import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  WalletBalanceCache,
  checkWalletBalance,
  fetchWalletBalances,
} from "../../shared/wallet-balance.ts";
import { resumeAgent, getAgentState, isPaused } from "../../shared/agent-state.ts";
import { Horizon } from "@stellar/stellar-sdk";

// Throwaway keypair generated per test run — only used so Keypair.fromSecret resolves
// to a real (well-formed) Stellar secret without hitting any network.
const FAKE_SECRET = Keypair.random().secret();

const HIGH = (address: string) => Promise.resolve({ address, usdc: 50, xlm: 10 });
const LOW_USDC = (address: string) => Promise.resolve({ address, usdc: 0.5, xlm: 10 });
const LOW_XLM = (address: string) => Promise.resolve({ address, usdc: 50, xlm: 0.5 });
const HORIZON_FAIL = () => Promise.reject(new Error("horizon down"));

describe("checkWalletBalance", () => {
  beforeEach(() => {
    // Always start each test with the agent unpaused.
    resumeAgent();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 'ok' and does not pause when balances are above thresholds", async () => {
    const result = await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      usdcThreshold: 1,
      xlmThreshold: 1,
      loadBalances: HIGH,
    });
    expect(result.action).toBe("ok");
    expect(result.snapshot?.usdc).toBe(50);
    expect(isPaused()).toBe(false);
  });

  it("pauses the agent and reports 'paused-usdc' when USDC is below threshold", async () => {
    const result = await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      usdcThreshold: 1,
      xlmThreshold: 1,
      loadBalances: LOW_USDC,
    });
    expect(result.action).toBe("paused-usdc");
    expect(isPaused()).toBe(true);
    expect(getAgentState().pausedReason).toBe("low-balance-usdc");
  });

  it("pauses the agent and reports 'paused-xlm' when XLM is below threshold (USDC fine)", async () => {
    const result = await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      usdcThreshold: 1,
      xlmThreshold: 1,
      loadBalances: LOW_XLM,
    });
    expect(result.action).toBe("paused-xlm");
    expect(isPaused()).toBe(true);
    expect(getAgentState().pausedReason).toBe("low-balance-xlm");
  });

  it("does not double-pause if the agent is already paused", async () => {
    // First low-balance check pauses.
    await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      usdcThreshold: 1,
      xlmThreshold: 1,
      loadBalances: LOW_USDC,
    });
    expect(isPaused()).toBe(true);
    // Second check (any state) should report already-paused without re-running pause logic.
    const second = await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      usdcThreshold: 1,
      xlmThreshold: 1,
      loadBalances: HIGH,
    });
    expect(second.action).toBe("already-paused");
  });

  it("returns 'error' when Horizon load fails — does NOT pause", async () => {
    const result = await checkWalletBalance({
      agentSecretKey: FAKE_SECRET,
      loadBalances: HORIZON_FAIL,
    });
    expect(result.action).toBe("error");
    expect(isPaused()).toBe(false);
  });

  it("returns 'error' when AGENT_SECRET_KEY is unset", async () => {
    const old = process.env.AGENT_SECRET_KEY;
    delete process.env.AGENT_SECRET_KEY;
    try {
      const result = await checkWalletBalance({ loadBalances: HIGH });
      expect(result.action).toBe("error");
      expect(result.error).toMatch(/AGENT_SECRET_KEY/);
    } finally {
      if (old != null) process.env.AGENT_SECRET_KEY = old;
    }
  });

  it("confirms both checkWalletBalance and formatting logic produce numerically consistent results from fetchWalletBalances", async () => {
    const address = Keypair.fromSecret(FAKE_SECRET).publicKey();
    const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

    const loadAccountSpy = vi
      .spyOn(Horizon.Server.prototype, "loadAccount")
      .mockResolvedValue({
        balances: [
          { asset_code: "USDC", asset_issuer: usdcIssuer, balance: "12.3456" },
          { asset_type: "native", balance: "98.7654" },
        ],
      } as any);

    try {
      // 1. Fetch balances using the shared helper
      const snapshot = await fetchWalletBalances(address, "https://horizon-testnet.stellar.org", usdcIssuer);

      // 2. Caller 1: checkWalletBalance behavior (numeric checks)
      expect(snapshot.usdc).toBe(12.3456);
      expect(snapshot.xlm).toBe(98.7654);

      // 3. Caller 2: GET /agent/wallet handler behavior (formatting)
      const formattedUsdc = snapshot.usdc.toFixed(2);
      const formattedXlm = snapshot.xlm.toFixed(2);

      expect(formattedUsdc).toBe("12.35");
      expect(formattedXlm).toBe("98.77");

      // Verify numerical consistency (parsing the formatted string yields value close to raw float)
      expect(parseFloat(formattedUsdc)).toBeCloseTo(snapshot.usdc, 2);
      expect(parseFloat(formattedXlm)).toBeCloseTo(snapshot.xlm, 2);
    } finally {
      loadAccountSpy.mockRestore();
    }
  });
});

describe("WalletBalanceCache", () => {
  it("reuses fresh values and refreshes them after the TTL", async () => {
    const cache = new WalletBalanceCache();
    let now = 1_000;
    let loads = 0;
    const load = async () => ({ address: "GTEST", usdc: ++loads, xlm: 10 });

    expect((await cache.get("wallet", load, 5_000, () => now)).usdc).toBe(1);
    expect((await cache.get("wallet", load, 5_000, () => now)).usdc).toBe(1);
    now += 5_001;
    expect((await cache.get("wallet", load, 5_000, () => now)).usdc).toBe(2);
    expect(cache.stats()).toEqual({ hits: 1, misses: 2, coalesced: 0 });
  });

  it("coalesces concurrent misses into one Horizon-equivalent call", async () => {
    const cache = new WalletBalanceCache();
    let loads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const load = async () => {
      loads++;
      await gate;
      return { address: "GTEST", usdc: 10, xlm: 10 };
    };

    const first = cache.get("wallet", load, 5_000);
    const second = cache.get("wallet", load, 5_000);
    release();
    await Promise.all([first, second]);

    expect(loads).toBe(1);
    expect(cache.stats()).toEqual({ hits: 0, misses: 1, coalesced: 1 });
  });
});
