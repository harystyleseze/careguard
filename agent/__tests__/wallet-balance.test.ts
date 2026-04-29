import { describe, it, expect, beforeEach, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { checkWalletBalance } from "../../shared/wallet-balance.ts";
import { resumeAgent, getAgentState, isPaused } from "../../shared/agent-state.ts";

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
});
