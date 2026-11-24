/**
 * Game-Day Drill #963: Zero-Downtime AGENT_API_KEY Rotation Probe
 *
 * Continuously polls GET /agent/status against a staging CareGuard instance
 * while operators execute the three-phase dual-key rotation in
 * docs/runbooks/rotate-agent-api-key.md:
 *   Phase 1: Dual-key support (old + new keys both return 200)
 *   Phase 2: Dashboard/client cutover to new key (zero 401s)
 *   Phase 3: Old-key removal (old key transitions to 401, new key remains 200)
 *
 * Usage:
 *   OLD_AGENT_API_KEY=... NEW_AGENT_API_KEY=... \
 *   node --import tsx scripts/drills/drill-agent-api-key-rotation.ts \
 *     --url https://careguard-staging.onrender.com \
 *     [--interval-ms 1000] [--duration-ms 900000] [--target-duration-ms 900000]
 *
 * Post-rotation verification only:
 *   OLD_AGENT_API_KEY=... NEW_AGENT_API_KEY=... \
 *   node --import tsx scripts/drills/drill-agent-api-key-rotation.ts \
 *     --url https://careguard-staging.onrender.com \
 *     --verify-only
 */

interface DrillOptions {
  url: string;
  oldKey: string;
  newKey: string;
  intervalMs: number;
  durationMs: number;
  targetDurationMs: number;
  verifyOnly: boolean;
}

interface PollSample {
  timestamp: string;
  elapsedMs: number;
  oldKeyStatus: number | null;
  newKeyStatus: number | null;
  error?: string;
}

function parseArgs(argv: string[]): DrillOptions {
  const getFlag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const url = (getFlag("--url") || process.env.STAGING_URL || "").replace(/\/+$/, "");
  if (!url) {
    throw new Error("Missing required --url <staging-url> (or STAGING_URL env var)");
  }

  const oldKey =
    getFlag("--old-key") ||
    process.env.OLD_AGENT_API_KEY ||
    process.env.AGENT_API_KEY ||
    "";
  const newKey =
    getFlag("--new-key") || process.env.NEW_AGENT_API_KEY || "";

  if (!oldKey || !newKey) {
    throw new Error(
      "Both --old-key (or OLD_AGENT_API_KEY / AGENT_API_KEY) and --new-key (or NEW_AGENT_API_KEY) are required",
    );
  }

  return {
    url,
    oldKey,
    newKey,
    intervalMs: Number(getFlag("--interval-ms") || 1000),
    durationMs: Number(getFlag("--duration-ms") || 900_000),
    targetDurationMs: Number(getFlag("--target-duration-ms") || 900_000),
    verifyOnly: argv.includes("--verify-only"),
  };
}

async function probeAgentStatus(baseUrl: string, apiKey: string): Promise<number> {
  const res = await fetch(`${baseUrl}/agent/status`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  return res.status;
}

async function verifyPostRotation(opts: DrillOptions): Promise<boolean> {
  console.log("\n--- Post-Rotation Verification Checklist ---");

  const healthRes = await fetch(`${opts.url}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  const oldStatus = await probeAgentStatus(opts.url, opts.oldKey);
  const newStatus = await probeAgentStatus(opts.url, opts.newKey);

  const healthOk = healthRes.status === 200;
  const oldRejected = oldStatus === 401;
  const newAccepted = newStatus === 200;

  console.log(`GET /health              -> ${healthRes.status} (expected 200) [${healthOk ? "PASS" : "FAIL"}]`);
  console.log(`GET /agent/status (old)  -> ${oldStatus} (expected 401) [${oldRejected ? "PASS" : "FAIL"}]`);
  console.log(`GET /agent/status (new)  -> ${newStatus} (expected 200) [${newAccepted ? "PASS" : "FAIL"}]`);

  return healthOk && oldRejected && newAccepted;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log("\n=== Drill #963: Zero-Downtime AGENT_API_KEY Rotation ===");
  console.log(`Target: ${opts.url}`);

  if (opts.verifyOnly) {
    const ok = await verifyPostRotation(opts);
    if (!ok) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(
    `Polling every ${opts.intervalMs}ms (max ${opts.durationMs}ms, target window <= ${opts.targetDurationMs}ms). Press Ctrl+C when Phase 3 is complete.`,
  );

  const startedAt = Date.now();
  const samples: PollSample[] = [];
  let dualKeyDetectedAt: number | null = null;
  let oldKeyRevokedAt: number | null = null;
  let unexpected401s = 0;
  let stopped = false;

  const stopHandler = () => {
    stopped = true;
  };
  process.on("SIGINT", stopHandler);
  process.on("SIGTERM", stopHandler);

  while (!stopped && Date.now() - startedAt < opts.durationMs) {
    const elapsedMs = Date.now() - startedAt;
    const sample: PollSample = {
      timestamp: new Date().toISOString(),
      elapsedMs,
      oldKeyStatus: null,
      newKeyStatus: null,
    };

    try {
      const [oldStatus, newStatus] = await Promise.all([
        probeAgentStatus(opts.url, opts.oldKey),
        probeAgentStatus(opts.url, opts.newKey),
      ]);
      sample.oldKeyStatus = oldStatus;
      sample.newKeyStatus = newStatus;

      if (dualKeyDetectedAt === null && oldStatus === 200 && newStatus === 200) {
        dualKeyDetectedAt = elapsedMs;
        console.log(`[${sample.timestamp}] Phase 1 detected: dual-key active (both keys 200) at ${elapsedMs}ms`);
      }

      // Unexpected 401: old key fails before Phase 3 (new key not yet 200),
      // or new key fails after dual-key was already active.
      if (oldStatus === 401 && newStatus !== 200) {
        unexpected401s += 1;
        console.error(`[${sample.timestamp}] UNEXPECTED 401 on old key while new key returned ${newStatus}`);
      }
      if (dualKeyDetectedAt !== null && newStatus === 401) {
        unexpected401s += 1;
        console.error(`[${sample.timestamp}] UNEXPECTED 401 on new key after dual-key activation`);
      }

      if (
        dualKeyDetectedAt !== null &&
        oldKeyRevokedAt === null &&
        oldStatus === 401 &&
        newStatus === 200
      ) {
        oldKeyRevokedAt = elapsedMs;
        console.log(`[${sample.timestamp}] Phase 3 detected: old key revoked (401), new key active (200) at ${elapsedMs}ms`);
        break;
      }

      console.log(
        `[${sample.timestamp}] t=${elapsedMs}ms old=${oldStatus} new=${newStatus}`,
      );
    } catch (err) {
      sample.error = err instanceof Error ? err.message : String(err);
      console.error(`[${sample.timestamp}] t=${elapsedMs}ms error=${sample.error}`);
    }

    samples.push(sample);
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }

  const totalElapsedMs = Date.now() - startedAt;
  const withinTarget = totalElapsedMs <= opts.targetDurationMs;

  console.log("\n=== Drill #963 Summary ===");
  console.log(`Total samples:          ${samples.length}`);
  console.log(`Unexpected 401 count:   ${unexpected401s}`);
  console.log(`Phase 1 dual-key at:    ${dualKeyDetectedAt !== null ? `${dualKeyDetectedAt}ms` : "not observed"}`);
  console.log(`Phase 3 old-revoked at: ${oldKeyRevokedAt !== null ? `${oldKeyRevokedAt}ms` : "not observed"}`);
  console.log(`Total elapsed window:   ${totalElapsedMs}ms (target <= ${opts.targetDurationMs}ms: ${withinTarget ? "PASS" : "FAIL"})`);

  const verified = await verifyPostRotation(opts);
  if (unexpected401s > 0 || !withinTarget || !verified) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
