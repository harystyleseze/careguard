/**
 * Wallet low-balance check (issue #107).
 *
 * Loads the agent's account from Horizon, compares USDC and XLM balances
 * against thresholds, and on breach: pauses the agent, sends a notification,
 * and writes an audit log entry.
 *
 * Designed for two callers:
 *   1. scripts/check-wallet-balance.ts (one-shot, cron-friendly)
 *   2. In-process scheduler in server.ts (node-cron, gated by env)
 *
 * The Horizon client is injected so tests can mock balance loading without
 * hitting the network.
 */

import { Horizon, Keypair } from "@stellar/stellar-sdk";
import { pauseAgent, isPaused, getAgentState } from "./agent-state.ts";
import { notify } from "./notifications.ts";
import { appendAuditEntry } from "./audit-log.ts";

export interface BalanceSnapshot {
  usdc: number;
  xlm: number;
  address: string;
}

export interface WalletCheckResult {
  snapshot: BalanceSnapshot | null;
  action: "ok" | "paused-usdc" | "paused-xlm" | "already-paused" | "error";
  error?: string;
}

export interface WalletCheckOptions {
  agentSecretKey?: string;
  horizonUrl?: string;
  usdcThreshold?: number;
  xlmThreshold?: number;
  usdcIssuer?: string;
  // Inject for tests
  loadBalances?: (address: string) => Promise<BalanceSnapshot>;
}

const DEFAULT_HORIZON = "https://horizon-testnet.stellar.org";
const DEFAULT_USDC_ISSUER =
  process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export function getThresholds(opts?: WalletCheckOptions): { usdc: number; xlm: number } {
  const usdc = opts?.usdcThreshold ?? parseFloat(process.env.WALLET_LOW_USDC_THRESHOLD || "1");
  const xlm = opts?.xlmThreshold ?? parseFloat(process.env.WALLET_LOW_XLM_THRESHOLD || "1");
  return {
    usdc: Number.isFinite(usdc) && usdc >= 0 ? usdc : 1,
    xlm: Number.isFinite(xlm) && xlm >= 0 ? xlm : 1,
  };
}

async function defaultLoadBalances(address: string, horizonUrl: string, usdcIssuer: string): Promise<BalanceSnapshot> {
  const server = new Horizon.Server(horizonUrl);
  const account = await server.loadAccount(address);
  const usdcEntry = account.balances.find(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === usdcIssuer,
  );
  const xlmEntry = account.balances.find((b: any) => b.asset_type === "native");
  return {
    address,
    usdc: usdcEntry ? parseFloat((usdcEntry as any).balance) : 0,
    xlm: xlmEntry ? parseFloat((xlmEntry as any).balance) : 0,
  };
}

export async function checkWalletBalance(opts: WalletCheckOptions = {}): Promise<WalletCheckResult> {
  const secret = opts.agentSecretKey ?? process.env.AGENT_SECRET_KEY;
  if (!secret) {
    return { snapshot: null, action: "error", error: "AGENT_SECRET_KEY not set" };
  }

  let address: string;
  try {
    address = Keypair.fromSecret(secret).publicKey();
  } catch (err: any) {
    return { snapshot: null, action: "error", error: `Invalid AGENT_SECRET_KEY: ${err?.message ?? err}` };
  }

  const horizonUrl = opts.horizonUrl ?? DEFAULT_HORIZON;
  const usdcIssuer = opts.usdcIssuer ?? DEFAULT_USDC_ISSUER;
  const thresholds = getThresholds(opts);
  const loadBalances =
    opts.loadBalances ?? ((addr: string) => defaultLoadBalances(addr, horizonUrl, usdcIssuer));

  let snapshot: BalanceSnapshot;
  try {
    snapshot = await loadBalances(address);
  } catch (err: any) {
    return { snapshot: null, action: "error", error: `Horizon error: ${err?.message ?? err}` };
  }

  if (isPaused()) {
    return { snapshot, action: "already-paused" };
  }

  if (snapshot.usdc < thresholds.usdc) {
    pauseAgent("low-balance-usdc");
    await notify({
      level: "critical",
      title: "Agent paused: low USDC balance",
      description: `Agent wallet USDC ${snapshot.usdc.toFixed(2)} is below threshold ${thresholds.usdc}. Fund the wallet and resume from the dashboard.`,
      context: { address, usdc: snapshot.usdc, xlm: snapshot.xlm, threshold: thresholds.usdc },
    });
    appendAuditEntry({
      event: "agent.auto-paused",
      actor: "wallet-balance-check",
      details: {
        reason: "low-balance-usdc",
        balance: snapshot.usdc,
        threshold: thresholds.usdc,
        address,
      },
    });
    return { snapshot, action: "paused-usdc" };
  }

  if (snapshot.xlm < thresholds.xlm) {
    pauseAgent("low-balance-xlm");
    await notify({
      level: "critical",
      title: "Agent paused: low XLM balance",
      description: `Agent wallet XLM ${snapshot.xlm.toFixed(2)} is below threshold ${thresholds.xlm}. Fund the wallet and resume from the dashboard.`,
      context: { address, usdc: snapshot.usdc, xlm: snapshot.xlm, threshold: thresholds.xlm },
    });
    appendAuditEntry({
      event: "agent.auto-paused",
      actor: "wallet-balance-check",
      details: {
        reason: "low-balance-xlm",
        balance: snapshot.xlm,
        threshold: thresholds.xlm,
        address,
      },
    });
    return { snapshot, action: "paused-xlm" };
  }

  return { snapshot, action: "ok" };
}

/**
 * Format a result for human reading (used by the CLI script and logs).
 */
export function formatResult(result: WalletCheckResult): string {
  const state = getAgentState();
  if (result.action === "error") return `wallet check FAILED — ${result.error}`;
  if (!result.snapshot) return "wallet check: no snapshot";
  const { usdc, xlm, address } = result.snapshot;
  const t = getThresholds();
  const tail =
    result.action === "ok"
      ? "OK"
      : result.action === "already-paused"
        ? `agent already paused (${state.pausedReason ?? "unknown"})`
        : `agent paused — reason: ${state.pausedReason}`;
  return `wallet=${address.slice(0, 8)}... USDC=${usdc.toFixed(2)} (≥${t.usdc}) XLM=${xlm.toFixed(2)} (≥${t.xlm}) → ${tail}`;
}
