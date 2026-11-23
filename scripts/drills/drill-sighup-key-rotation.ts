/**
 * Game-Day Drill #964: SIGHUP-based AGENT_SECRET_KEY Rotation Under Live Traffic
 *
 * Sends continuous x402-triggering requests against a staging CareGuard instance
 * so operators can rotate AGENT_SECRET_KEY + send SIGHUP mid-traffic (or test the
 * 60-second TTL fallback with --ttl-only) and inspect request timing/settlement.
 *
 * Usage:
 *   node --import tsx scripts/drills/drill-sighup-key-rotation.ts \
 *     --url https://careguard-staging.onrender.com \
 *     [--concurrency 4] [--interval-ms 500] [--duration-ms 45000] [--ttl-only]
 */

interface KeyRotationDrillOptions {
  url: string;
  concurrency: number;
  intervalMs: number;
  durationMs: number;
  ttlOnly: boolean;
  drug: string;
}

interface RequestRecord {
  id: number;
  startedAt: string;
  finishedAt: string;
  elapsedStartMs: number;
  latencyMs: number;
  status: number | null;
  paymentReceipt?: string | null;
  error?: string;
}

function parseArgs(argv: string[]): KeyRotationDrillOptions {
  const getFlag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const url = (getFlag("--url") || process.env.STAGING_URL || "").replace(/\/+$/, "");
  if (!url) {
    throw new Error("Missing required --url <staging-url> (or STAGING_URL env var)");
  }

  const ttlOnly = argv.includes("--ttl-only");
  return {
    url,
    concurrency: Number(getFlag("--concurrency") || (ttlOnly ? 1 : 4)),
    intervalMs: Number(getFlag("--interval-ms") || (ttlOnly ? 2000 : 500)),
    durationMs: Number(getFlag("--duration-ms") || (ttlOnly ? 85_000 : 45_000)),
    ttlOnly,
    drug: getFlag("--drug") || "lisinopril",
  };
}

async function sendX402Request(
  id: number,
  baseUrl: string,
  drug: string,
  runStartedAt: number,
): Promise<RequestRecord> {
  const reqStart = Date.now();
  const startedAt = new Date(reqStart).toISOString();
  const elapsedStartMs = reqStart - runStartedAt;

  try {
    const res = await fetch(`${baseUrl}/pharmacy/compare?drug=${encodeURIComponent(drug)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const reqEnd = Date.now();
    return {
      id,
      startedAt,
      finishedAt: new Date(reqEnd).toISOString(),
      elapsedStartMs,
      latencyMs: reqEnd - reqStart,
      status: res.status,
      paymentReceipt: res.headers.get("payment-response") || res.headers.get("payment-receipt"),
    };
  } catch (err) {
    const reqEnd = Date.now();
    return {
      id,
      startedAt,
      finishedAt: new Date(reqEnd).toISOString(),
      elapsedStartMs,
      latencyMs: reqEnd - reqStart,
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `\n=== Drill #964: AGENT_SECRET_KEY Rotation (${opts.ttlOnly ? "60s TTL Fallback" : "SIGHUP Mid-Traffic"}) ===`,
  );
  console.log(`Target: ${opts.url} | concurrency=${opts.concurrency} | duration=${opts.durationMs}ms`);

  const runStartedAt = Date.now();
  const records: RequestRecord[] = [];
  let nextId = 1;

  const worker = async () => {
    while (Date.now() - runStartedAt < opts.durationMs) {
      const id = nextId++;
      const rec = await sendX402Request(id, opts.url, opts.drug, runStartedAt);
      records.push(rec);
      console.log(
        `[#${rec.id} @ ${rec.elapsedStartMs}ms] status=${rec.status} latency=${rec.latencyMs}ms${rec.error ? ` err=${rec.error}` : ""}`,
      );
      await new Promise((r) => setTimeout(r, opts.intervalMs));
    }
  };

  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));

  const succeeded = records.filter((r) => r.status !== null && r.status < 500);
  const failed = records.filter((r) => r.status === null || r.status >= 500);

  console.log("\n=== Summary ===");
  console.log(`Total requests: ${records.length}`);
  console.log(`Succeeded (<500): ${succeeded.length}`);
  console.log(`Failed (>=500 or network error): ${failed.length}`);
}

main().catch((err) => {
  console.error("Drill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
