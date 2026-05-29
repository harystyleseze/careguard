#!/usr/bin/env node
/**
 * Agent wallet rotation script (issue #95).
 *
 * Generates a new Stellar keypair, sweeps USDC + XLM from the old wallet to
 * the new one, and prints the updated env-var lines to paste into .env or the
 * Render dashboard.
 *
 * Usage:
 *   npx tsx scripts/rotate-agent-wallet.ts           # dry run (safe, no txs)
 *   npx tsx scripts/rotate-agent-wallet.ts --execute  # broadcast on STELLAR_NETWORK
 *
 * After --execute: update AGENT_SECRET_KEY + AGENT_PUBLIC_KEY in your env, then restart.
 */

import "dotenv/config";
import {
  Keypair,
  Horizon,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";

const EXECUTE = process.argv.includes("--execute");
const NETWORK = process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";
const HORIZON_URL =
  NETWORK === "public"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  NETWORK === "public" ? Networks.PUBLIC : Networks.TESTNET;
const USDC_ISSUER =
  process.env.USDC_ISSUER ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const OLD_SECRET = process.env.AGENT_SECRET_KEY;
if (!OLD_SECRET) {
  console.error("AGENT_SECRET_KEY not set in environment. Aborting.");
  process.exit(1);
}

const horizon = new Horizon.Server(HORIZON_URL);

async function main() {
  const oldKeypair = Keypair.fromSecret(OLD_SECRET!);
  const newKeypair = Keypair.random();

  console.log("\n=== CareGuard Agent Wallet Rotation ===");
  console.log(`Network:     ${NETWORK}`);
  console.log(`Old wallet:  ${oldKeypair.publicKey()}`);
  console.log(`New wallet:  ${newKeypair.publicKey()}`);
  console.log(`Mode:        ${EXECUTE ? "EXECUTE (broadcasting)" : "DRY RUN (no transactions)"}`);
  console.log("");

  // Load old account state
  let oldAccount: Horizon.AccountResponse;
  try {
    oldAccount = await horizon.loadAccount(oldKeypair.publicKey());
  } catch {
    console.error("Could not load old agent wallet from Horizon. Is STELLAR_NETWORK correct?");
    process.exit(1);
  }

  const usdcBalance = oldAccount.balances.find(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );
  const xlmBalance = oldAccount.balances.find((b: any) => b.asset_type === "native");

  const xlmAvailable = parseFloat(xlmBalance?.balance ?? "0");
  const usdcAvailable = parseFloat(usdcBalance?.balance ?? "0");
  const xlmForBaseReserve = 2.5;  // base reserve (2×0.5) + 1 trustline + buffer
  const xlmForFees = 0.01;
  const xlmToSend = Math.max(0, xlmAvailable - xlmForBaseReserve - xlmForFees);

  console.log(`Old USDC balance: ${usdcAvailable}`);
  console.log(`Old XLM balance:  ${xlmAvailable}`);
  console.log(`XLM to transfer:  ${xlmToSend.toFixed(7)} (keeping ${xlmForBaseReserve} for reserves + fees)`);
  console.log(`USDC to sweep:    ${usdcAvailable}`);
  console.log("");

  if (xlmToSend < 1) {
    console.error("Insufficient XLM to fund the new wallet (need at least 1 XLM to transfer).");
    console.error("Fund the old wallet first, then re-run.");
    process.exit(1);
  }

  if (!EXECUTE) {
    console.log("DRY RUN — no transactions broadcast. Re-run with --execute to proceed.");
    printUpdateInstructions(newKeypair);
    return;
  }

  // Step 1: Create new account and fund with XLM
  console.log("Step 1: Creating new account + sending XLM...");
  const oldAccountFresh = await horizon.loadAccount(oldKeypair.publicKey());
  const createTx = new TransactionBuilder(oldAccountFresh, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: newKeypair.publicKey(),
        startingBalance: xlmToSend.toFixed(7),
      })
    )
    .setTimeout(30)
    .build();

  createTx.sign(oldKeypair);
  const createResult = await horizon.submitTransaction(createTx);
  console.log(`  ✓ New account created. TX: ${(createResult as any).hash}`);

  // Step 2: Establish USDC trustline on new account
  if (usdcAvailable > 0) {
    console.log("Step 2: Establishing USDC trustline on new account...");
    const newAccountFresh = await horizon.loadAccount(newKeypair.publicKey());
    const trustTx = new TransactionBuilder(newAccountFresh, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.changeTrust({
          asset: new Asset("USDC", USDC_ISSUER),
        })
      )
      .setTimeout(30)
      .build();

    trustTx.sign(newKeypair);
    const trustResult = await horizon.submitTransaction(trustTx);
    console.log(`  ✓ USDC trustline established. TX: ${(trustResult as any).hash}`);

    // Step 3: Sweep USDC
    console.log(`Step 3: Sweeping ${usdcAvailable} USDC to new wallet...`);
    const oldAccountForUsdc = await horizon.loadAccount(oldKeypair.publicKey());
    const usdcTx = new TransactionBuilder(oldAccountForUsdc, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: newKeypair.publicKey(),
          asset: new Asset("USDC", USDC_ISSUER),
          amount: usdcAvailable.toFixed(7),
        })
      )
      .setTimeout(30)
      .build();

    usdcTx.sign(oldKeypair);
    const usdcResult = await horizon.submitTransaction(usdcTx);
    console.log(`  ✓ USDC swept. TX: ${(usdcResult as any).hash}`);
  } else {
    console.log("Step 2-3: No USDC to sweep — skipping trustline and USDC transfer.");
  }

  console.log("\n=== Rotation complete ===");
  printUpdateInstructions(newKeypair);
}

function printUpdateInstructions(newKeypair: Keypair) {
  console.log("\n--- Update your .env or Render environment with: ---");
  console.log(`AGENT_SECRET_KEY=${newKeypair.secret()}`);
  console.log(`AGENT_PUBLIC_KEY=${newKeypair.publicKey()}`);
  console.log("-----------------------------------------------------");
  console.log("\nNext steps:");
  console.log("  1. Update the env vars above in .env or your hosting dashboard.");
  console.log("  2. Restart the server.");
  console.log("  3. Verify the dashboard shows the new wallet address.");
  console.log("  4. Fund the new wallet with USDC if needed (https://faucet.circle.com for testnet).");
}

main().catch((err) => {
  console.error(`Rotation failed: ${err?.message ?? err}`);
  process.exit(1);
});
