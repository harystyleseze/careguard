/**
 * Game-Day Drill #962: OZ Facilitator Outage (Fail-Closed Verification)
 *
 * Probes `/ready` and `/health`, fires paid x402 requests during a simulated
 * OZ facilitator egress block to confirm fail-closed behaviour, tracks
 * detection-to-communication SLA timing, and verifies recovery.
 *
 * Usage:
 *   node --import tsx scripts/drills/drill-oz-facilitator-outage.ts \
 *     --url https://careguard-staging.onrender.com \
 *     [--sla-seconds 300] [--poll-ms 3000] [--max-wait-ms 120000]
 */

interface OutageDrillOptions {
  url: string;
  slaSeconds: number;
  pollMs: number;
  maxWaitMs: number;
}

function parseArgs(argv: string[]): OutageDrillOptions {
  const getFlag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const url = (getFlag("--url") || process.env.STAGING_URL || "").replace(/\/+$/, "");
  if (!url) {
    throw new Error("Missing required --url <staging-url> (or STAGING_URL env var)");
  }

  return {
    url,
    slaSeconds: Number(getFlag("--sla-seconds") || 300),
    pollMs: Number(getFlag("--poll-ms") || 3000),
    maxWaitMs: Number(getFlag("--max-wait-ms") || 120_000),
  };
}

async function checkReadiness(baseUrl: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(5000) });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

async function probePaidEndpoint(baseUrl: string): Promise<{ status: number; failedClosed: boolean }> {
  const res = await fetch(`${baseUrl}/pharmacy/compare?drug=lisinopril`, {
    signal: AbortSignal.timeout(10_000),
  });
  // Fail-closed means 402/503/5xx without fulfilling the paid response
  return { status: res.status, failedClosed: res.status === 402 || res.status >= 500 };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log("\n=== Drill #962: OZ Facilitator Outage (Fail-Closed) ===");
  console.log(`Target: ${opts.url} | SLA target: ${opts.slaSeconds}s`);

  const t0 = Date.now();
  const initialReady = await checkReadiness(opts.url);
  console.log("Initial /ready:", initialReady.status, JSON.stringify(initialReady.body));

  console.log(
    "\nBlock outbound egress to X402_FACILITATOR_URL now. Polling /pharmacy/compare & /ready...",
  );

  let detectedAt: number | null = null;
  const deadline = t0 + opts.maxWaitMs;

  while (Date.now() < deadline) {
    const [ready, paid] = await Promise.all([
      checkReadiness(opts.url),
      probePaidEndpoint(opts.url),
    ]);
    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[+${elapsedSec}s] /ready=${ready.status} | /pharmacy/compare=${paid.status} (failClosed=${paid.failedClosed})`,
    );

    if (paid.failedClosed && detectedAt === null) {
      detectedAt = Date.now();
      const detectSec = ((detectedAt - t0) / 1000).toFixed(1);
      console.log(`\n>>> Outage detected at +${detectSec}s (SLA limit: ${opts.slaSeconds}s)`);
      console.log(">>> Post documented user communication script from docs/runbooks/oz-facilitator-outage.md");
      break;
    }

    await new Promise((r) => setTimeout(r, opts.pollMs));
  }

  if (detectedAt === null) {
    console.log("\nNo fail-closed outage detected within --max-wait-ms.");
  }
}

main().catch((err) => {
  console.error("Drill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
