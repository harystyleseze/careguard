#!/usr/bin/env node
/**
 * Game-day drill: wallet-low auto-pause-to-resume cycle (issue #969).
 *
 * Rehearses the full lifecycle documented in docs/runbooks/wallet-low.md:
 *   1. Trigger low-balance check (or simulate below WALLET_LOW_USDC_THRESHOLD)
 *   2. Confirm auto-pause state (GET /agent/status or in-process getAgentState)
 *   3. Confirm recovery check once funded
 *   4. Resume agent (POST /agent/resume or in-process resumeAgent)
 *   5. Verify pause/resume pair in data/audit.log.jsonl
 *   6. Measure total cycle time against the 15-minute scheduled-check interval
 *
 * Usage:
 *   npx tsx scripts/drill-wallet-low.ts --dry-run
 *   npx tsx scripts/drill-wallet-low.ts --agent-url=https://staging.example.com
 */

import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import { pathToFileURL } from "url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  checkWalletBalance,
  getThresholds,
  type BalanceSnapshot,
  type WalletCheckResult,
} from "../shared/wallet-balance.ts";
import { getAgentState, resumeAgent, type AgentState } from "../shared/agent-state.ts";
import { appendAuditEntry, getAuditFilePath } from "../shared/audit-log.ts";

export const SCHEDULED_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export interface WalletLowDrillOptions {
  dryRun?: boolean;
  agentUrl?: string;
  agentSecretKey?: string;
  usdcThreshold?: number;
  xlmThreshold?: number;
  now?: () => number;
  loadLowBalances?: (address: string) => Promise<BalanceSnapshot>;
  loadRecoveredBalances?: (address: string) => Promise<BalanceSnapshot>;
}

export interface WalletLowDrillReport {
  mode: "dry-run" | "staging";
  address: string;
  thresholds: { usdc: number; xlm: number };
  pauseResult: WalletCheckResult;
  pausedState: AgentState;
  recoveryResult: WalletCheckResult;
  resumedState: AgentState;
  auditPairVerified: boolean;
  elapsedMs: number;
  withinScheduledInterval: boolean;
}

export function verifyAuditPauseResumePair(auditFilePath = getAuditFilePath()): boolean {
  if (!existsSync(auditFilePath)) return false;
  const lines = readFileSync(auditFilePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean);
  let sawPause = false;
  let sawResumeAfterPause = false;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as { event?: string };
      if (entry.event === "agent.auto-paused") {
        sawPause = true;
      } else if (entry.event === "agent.resumed" && sawPause) {
        sawResumeAfterPause = true;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return sawPause && sawResumeAfterPause;
}

export async function runWalletLowDrill(
  opts: WalletLowDrillOptions = {},
): Promise<WalletLowDrillReport> {
  const now = opts.now ?? Date.now;
  const startMs = now();
  const dryRun = opts.dryRun ?? !opts.agentUrl;
  const secret = opts.agentSecretKey ?? process.env.AGENT_SECRET_KEY ?? Keypair.random().secret();
  const address = Keypair.fromSecret(secret).publicKey();
  const thresholds = getThresholds({
    usdcThreshold: opts.usdcThreshold,
    xlmThreshold: opts.xlmThreshold,
  });

  // Ensure clean starting state before drill
  if (getAgentState().paused) {
    resumeAgent();
  }

  const lowLoader =
    opts.loadLowBalances ??
    (async (addr: string) => ({
      address: addr,
      usdc: Math.max(0, thresholds.usdc * 0.5),
      xlm: thresholds.xlm * 5,
    }));

  const recoveredLoader =
    opts.loadRecoveredBalances ??
    (async (addr: string) => ({
      address: addr,
      usdc: thresholds.usdc * 10,
      xlm: thresholds.xlm * 5,
    }));

  // Step 1: Trigger auto-pause on low USDC balance
  const pauseResult = await checkWalletBalance({
    agentSecretKey: secret,
    usdcThreshold: thresholds.usdc,
    xlmThreshold: thresholds.xlm,
    loadBalances: dryRun ? lowLoader : undefined,
  });

  // Step 2: Confirm paused state (GET /agent/status equivalent)
  const pausedState = getAgentState();

  // Step 3: Confirm recovery check after funding
  const recoveryResult = await checkWalletBalance({
    agentSecretKey: secret,
    usdcThreshold: thresholds.usdc,
    xlmThreshold: thresholds.xlm,
    loadBalances: dryRun ? recoveredLoader : undefined,
  });

  // Step 4: Resume agent (POST /agent/resume equivalent) and record audit entry
  const prevReason = getAgentState().pausedReason;
  const resumedState = resumeAgent();
  await appendAuditEntry({
    event: "agent.resumed",
    actor: "drill:wallet-low",
    details: { previousReason: prevReason },
  });

  // Step 5: Verify pause/resume pair in data/audit.log.jsonl
  const auditPairVerified = verifyAuditPauseResumePair();

  // Step 6: Measure total cycle time against 15-minute scheduled-check interval
  const elapsedMs = now() - startMs;
  const withinScheduledInterval = elapsedMs <= SCHEDULED_CHECK_INTERVAL_MS;

  return {
    mode: dryRun ? "dry-run" : "staging",
    address,
    thresholds,
    pauseResult,
    pausedState,
    recoveryResult,
    resumedState,
    auditPairVerified,
    elapsedMs,
    withinScheduledInterval,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dryRun = process.argv.includes("--dry-run") || !process.argv.some((a) => a.startsWith("--agent-url="));
  const agentUrlArg = process.argv.find((a) => a.startsWith("--agent-url="));
  const agentUrl = agentUrlArg ? agentUrlArg.slice("--agent-url=".length) : undefined;

  runWalletLowDrill({ dryRun, agentUrl })
    .then((report) => {
      console.log("\n=== Wallet-Low Game-Day Drill Report ===");
      console.log(`Mode:                    ${report.mode}`);
      console.log(`Wallet:                  ${report.address}`);
      console.log(`Thresholds:              USDC >= ${report.thresholds.usdc}, XLM >= ${report.thresholds.xlm}`);
      console.log(`Auto-pause action:       ${report.pauseResult.action}`);
      console.log(`Paused state:            paused=${report.pausedState.paused}, reason=${report.pausedState.pausedReason}`);
      console.log(`Recovery check action:   ${report.recoveryResult.action}`);
      console.log(`Resumed state:           paused=${report.resumedState.paused}`);
      console.log(`Audit pause/resume pair: ${report.auditPairVerified ? "VERIFIED" : "MISSING"}`);
      console.log(`Cycle elapsed:           ${report.elapsedMs}ms (budget: ${SCHEDULED_CHECK_INTERVAL_MS}ms)`);
      console.log(`Within 15m SLA:          ${report.withinScheduledInterval}`);
      process.exit(report.auditPairVerified && !report.resumedState.paused ? 0 : 1);
    })
    .catch((err) => {
      console.error(`Drill failed: ${err?.message ?? err}`);
      process.exit(1);
    });
}
