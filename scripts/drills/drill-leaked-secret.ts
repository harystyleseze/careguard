/**
 * Game-Day Drill #961: Leaked-Secret Tabletop Helper (Testnet Only)
 *
 * Supports two safe testnet-only modes:
 *   --setup   Generates a disposable Stellar testnet keypair, funds it via
 *             Friendbot, and writes a disposable .env.drill file.
 *   --verify  Verifies on Horizon Testnet that the compromised wallet was swept
 *             and the new wallet received funds, and checks TTC against target.
 *
 * Safety: Hard-refuses to run if STELLAR_NETWORK=public.
 *
 * Usage:
 *   node --import tsx scripts/drills/drill-leaked-secret.ts --setup [--env-file .env.drill]
 *   node --import tsx scripts/drills/drill-leaked-secret.ts --verify --old-public G... --new-public G... [--started-at-ms <epochMs>] [--target-ms 600000]
 */

import fs from "fs";
import path from "path";
import { Keypair } from "@stellar/stellar-sdk";
import { fetchWalletBalances } from "../../shared/wallet-balance.ts";

const TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const TESTNET_USDC_ISSUER =
  process.env.USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function assertTestnetOnly(): void {
  if (process.env.STELLAR_NETWORK === "public") {
    throw new Error(
      "SAFETY ABORT: Drill #961 is testnet-only and must never run with STELLAR_NETWORK=public.",
    );
  }
}

function getFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
}

async function runSetup(envFile: string): Promise<void> {
  const kp = Keypair.random();
  console.log("\n=== Drill #961 Setup (Testnet Only) ===");
  console.log(`Disposable public key: ${kp.publicKey()}`);
  console.log("Funding via Stellar Testnet Friendbot...");

  const res = await fetch(
    `${FRIENDBOT_URL}?addr=${encodeURIComponent(kp.publicKey())}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) {
    throw new Error(`Friendbot funding failed: HTTP ${res.status}`);
  }

  const targetPath = path.resolve(process.cwd(), envFile);
  const content = [
    "# Disposable testnet-only env file for Game-Day Drill #961",
    "STELLAR_NETWORK=testnet",
    `AGENT_PUBLIC_KEY=${kp.publicKey()}`,
    `AGENT_SECRET_KEY=${kp.secret()}`,
    `DRILL_STARTED_AT_MS=${Date.now()}`,
    "",
  ].join("\n");

  fs.writeFileSync(targetPath, content, { mode: 0o600 });
  console.log(`Wrote disposable env file: ${targetPath}`);
  console.log(`T0 (epoch ms): ${Date.now()}`);
  console.log(
    "Next: run scripts/rotate-agent-wallet.ts against this disposable testnet keypair.",
  );
}

async function runVerify(argv: string[]): Promise<void> {
  const oldPublic = getFlag(argv, "--old-public");
  const newPublic = getFlag(argv, "--new-public");
  if (!oldPublic || !newPublic) {
    throw new Error("--verify requires --old-public <G...> and --new-public <G...>");
  }

  const startedAtMs = Number(
    getFlag(argv, "--started-at-ms") || process.env.DRILL_STARTED_AT_MS || 0,
  );
  const targetMs = Number(getFlag(argv, "--target-ms") || 600_000);

  console.log("\n=== Drill #961 Containment Verification (Testnet) ===");
  const [oldBal, newBal] = await Promise.all([
    fetchWalletBalances(oldPublic, TESTNET_HORIZON, TESTNET_USDC_ISSUER),
    fetchWalletBalances(newPublic, TESTNET_HORIZON, TESTNET_USDC_ISSUER),
  ]);

  console.log(`Old wallet (${oldPublic.slice(0, 8)}...): XLM=${oldBal.xlm}, USDC=${oldBal.usdc}`);
  console.log(`New wallet (${newPublic.slice(0, 8)}...): XLM=${newBal.xlm}, USDC=${newBal.usdc}`);

  const newFunded = newBal.xlm > 0;
  const oldUsdcDrained = oldBal.usdc === 0;
  console.log(`New wallet funded:      ${newFunded ? "PASS" : "FAIL"}`);
  console.log(`Old wallet USDC swept:  ${oldUsdcDrained ? "PASS" : "FAIL"}`);

  let withinTarget = true;
  if (startedAtMs > 0) {
    const ttcMs = Date.now() - startedAtMs;
    withinTarget = ttcMs <= targetMs;
    console.log(
      `Time-to-Containment:    ${ttcMs}ms (target <= ${targetMs}ms: ${withinTarget ? "PASS" : "FAIL"})`,
    );
  }

  if (!newFunded || !oldUsdcDrained || !withinTarget) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  assertTestnetOnly();
  const argv = process.argv.slice(2);

  if (argv.includes("--setup")) {
    const envFile = getFlag(argv, "--env-file") || ".env.drill";
    await runSetup(envFile);
    return;
  }

  if (argv.includes("--verify")) {
    await runVerify(argv);
    return;
  }

  throw new Error("Specify either --setup or --verify");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
