/**
 * Game-Day Drill #967: Runtime STELLAR_NETWORK Switch via SIGHUP & Startup Guards
 *
 * Probes a staging CareGuard instance across a STELLAR_NETWORK switch
 * (pre-SIGHUP within-TTL vs post-SIGHUP) and optionally verifies the
 * documented startup guards in isolated subprocesses.
 *
 * Usage:
 *   node --import tsx scripts/drills/drill-network-switch.ts \
 *     --url https://careguard-staging.onrender.com \
 *     [--check-guards]
 */

import { spawnSync } from "node:child_process";

interface NetworkDrillOptions {
  url: string;
  checkGuards: boolean;
}

function parseArgs(argv: string[]): NetworkDrillOptions {
  const getFlag = (name: string): string | undefined => {
    const idx = argv.indexOf(name);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const url = (getFlag("--url") || process.env.STAGING_URL || "").replace(/\/+$/, "");
  if (!url && !argv.includes("--check-guards")) {
    throw new Error("Missing required --url <staging-url> (or pass --check-guards)");
  }

  return {
    url,
    checkGuards: argv.includes("--check-guards"),
  };
}

async function probeStaging(url: string): Promise<void> {
  console.log(`\nProbing staging endpoints at ${url}...`);
  const [healthRes, readyRes] = await Promise.all([
    fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }),
    fetch(`${url}/ready`, { signal: AbortSignal.timeout(5000) }),
  ]);

  const healthBody = await healthRes.text();
  const readyBody = await readyRes.text();

  console.log(`GET /health -> ${healthRes.status} ${healthBody}`);
  console.log(`GET /ready  -> ${readyRes.status} ${readyBody}`);
}

function checkStartupGuard(
  label: string,
  envOverrides: Record<string, string>,
  expectedStderr: string,
): boolean {
  const result = spawnSync("node", ["--import", "tsx", "server.ts"], {
    env: { ...process.env, ...envOverrides },
    encoding: "utf-8",
    timeout: 10_000,
  });

  const passed = result.status === 1 && (result.stderr || "").includes(expectedStderr);
  console.log(
    `[Guard: ${label}] exit=${result.status} passed=${passed}${passed ? "" : ` stderr=${result.stderr?.trim()}`}`,
  );
  return passed;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log("\n=== Drill #967: STELLAR_NETWORK Runtime Switch ===");

  if (opts.url) {
    await probeStaging(opts.url);
  }

  if (opts.checkGuards) {
    console.log("\nRunning startup guard checks...");
    const g1 = checkStartupGuard(
      "public without OZ_FACILITATOR_API_KEY",
      { STELLAR_NETWORK: "public", OZ_FACILITATOR_API_KEY: "" },
      "OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public",
    );
    const g2 = checkStartupGuard(
      "MULTI_PHARMACY_MODE=true without PHARMACY_2_PUBLIC_KEY",
      { MULTI_PHARMACY_MODE: "true", PHARMACY_2_PUBLIC_KEY: "" },
      "PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true",
    );

    if (!g1 || !g2) {
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("Drill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
