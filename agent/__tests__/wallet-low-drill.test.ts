import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";
import { runWalletLowDrill, SCHEDULED_CHECK_INTERVAL_MS } from "../../scripts/drill-wallet-low.ts";
import { resumeAgent } from "../../shared/agent-state.ts";

describe("Wallet-low auto-pause-to-resume game-day drill (Issue #969)", () => {
  let tempDir: string;
  let origAuditFile: string | undefined;
  let origDataDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "careguard-wallet-drill-"));
    origAuditFile = process.env.AUDIT_LOG_FILE;
    origDataDir = process.env.DATA_DIR;
    process.env.AUDIT_LOG_FILE = path.join(tempDir, "audit.log.jsonl");
    process.env.DATA_DIR = tempDir;
    resumeAgent();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (origAuditFile === undefined) delete process.env.AUDIT_LOG_FILE;
    else process.env.AUDIT_LOG_FILE = origAuditFile;
    if (origDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = origDataDir;
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("completes the full pause -> notify -> fund recovery -> resume -> audit-log cycle within 15m budget", async () => {
    const secret = Keypair.random().secret();
    let tick = 1_000;
    const report = await runWalletLowDrill({
      dryRun: true,
      agentSecretKey: secret,
      usdcThreshold: 1,
      xlmThreshold: 1,
      now: () => {
        tick += 250;
        return tick;
      },
    });

    expect(report.pauseResult.action).toBe("paused-usdc");
    expect(report.pausedState.paused).toBe(true);
    expect(report.pausedState.pausedReason).toBe("low-balance-usdc");
    expect(report.recoveryResult.action).toBe("already-paused");
    expect(report.resumedState.paused).toBe(false);
    expect(report.auditPairVerified).toBe(true);
    expect(report.elapsedMs).toBeLessThanOrEqual(SCHEDULED_CHECK_INTERVAL_MS);
    expect(report.withinScheduledInterval).toBe(true);
  });
});
