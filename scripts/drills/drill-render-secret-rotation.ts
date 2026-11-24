/**
 * Game-Day Drill #965: Render sync:false Secret Rotation Probe
 *
 * Probes a staging CareGuard instance before, during, and after a Render
 * `sync: false` secret update to verify:
 *   1. No automatic restart occurs on env var update alone.
 *   2. SIGHUP cutover completes with zero HTTP downtime.
 *   3. Manual-restart alternative path is timed (total restart + outage window).
 *
 * Usage:
 *   node --import tsx scripts/drills/drill-render-secret-rotation.ts \
 *     --url https://careguard-staging.onrender.com \
 *     --mode sighup \
 *     [--baseline-only] [--interval-ms 2000] [--duration-ms 90000]
 */

interface DrillOptions {
  url: string;
  mode: "sighup" | "restart";
  baselineOnly: boolean;
  intervalMs: number;
  durationMs: number;
}

interface ProbeSample {
  timestamp: string;
  elapsedMs: number;
  healthStatus: number | null;
  readyStatus: number | null;
  x402Status: number | null;
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

  const modeRaw = getFlag("--mode") || "sighup";
  if (modeRaw !== "sighup" && modeRaw !== "restart") {
    throw new Error(`Invalid --mode "${modeRaw}". Expected "sighup" or "restart".`);
  }

  return {
    url,
    mode: modeRaw,
    baselineOnly: argv.includes("--baseline-only"),
    intervalMs: Number(getFlag("--interval-ms") || 2000),
    durationMs: Number(getFlag("--duration-ms") || 90_000),
  };
}

async function probeOnce(baseUrl: string, elapsedMs: number): Promise<ProbeSample> {
  const sample: ProbeSample = {
    timestamp: new Date().toISOString(),
    elapsedMs,
    healthStatus: null,
    readyStatus: null,
    x402Status: null,
  };

  try {
    const [healthRes, readyRes] = await Promise.all([
      fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${baseUrl}/ready`, { signal: AbortSignal.timeout(5000) }),
    ]);
    sample.healthStatus = healthRes.status;
    sample.readyStatus = readyRes.status;

    const x402Res = await fetch(`${baseUrl}/pharmacy/compare?drug=lisinopril`, {
      signal: AbortSignal.timeout(8000),
    });
    sample.x402Status = x402Res.status;
  } catch (err) {
    sample.error = err instanceof Error ? err.message : String(err);
  }

  return sample;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`\n=== Drill #965: Render sync:false Secret Rotation (${opts.mode}) ===`);
  console.log(`Target: ${opts.url}`);

  const baseline = await probeOnce(opts.url, 0);
  console.log("Baseline:", JSON.stringify(baseline));

  if (opts.baselineOnly) {
    return;
  }

  const startedAt = Date.now();
  const samples: ProbeSample[] = [baseline];

  console.log(
    `\nPolling every ${opts.intervalMs}ms for ${opts.durationMs}ms. Perform the ${opts.mode} action now...`,
  );

  while (Date.now() - startedAt < opts.durationMs) {
    await new Promise((r) => setTimeout(r, opts.intervalMs));
    const sample = await probeOnce(opts.url, Date.now() - startedAt);
    samples.push(sample);
    console.log(
      `[${sample.elapsedMs}ms] health=${sample.healthStatus} ready=${sample.readyStatus} x402=${sample.x402Status}${sample.error ? ` err=${sample.error}` : ""}`,
    );
  }

  const downSamples = samples.filter((s) => s.healthStatus !== 200);
  console.log("\n=== Summary ===");
  console.log(`Total samples: ${samples.length}`);
  console.log(`Non-200 /health samples: ${downSamples.length}`);
  if (downSamples.length > 0) {
    const firstDown = downSamples[0].elapsedMs;
    const lastDown = downSamples[downSamples.length - 1].elapsedMs;
    console.log(`Observed unavailability window: ~${lastDown - firstDown + opts.intervalMs}ms`);
  } else {
    console.log("Zero /health downtime observed.");
  }
}

main().catch((err) => {
  console.error("Drill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
