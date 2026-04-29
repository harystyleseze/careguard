/**
 * Setup script: Creates and funds Stellar testnet wallets for CareGuard
 *
 * Creates wallets for: agent, caregiver, 3 pharmacies, bill provider
 * Funds each with XLM via Friendbot, creates USDC trustlines
 */

import { Keypair, Networks, TransactionBuilder, Operation, Asset, Horizon } from "@stellar/stellar-sdk";
import { recordStellarSubmit, recordStellarResult, recordStellarLatency } from "../shared/metrics.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

interface WalletInfo {
  name: string;
  publicKey: string;
  secretKey: string;
}

async function fundAccount(publicKey: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!response.ok) {
    const text = await response.text();
    // Friendbot returns an error if already funded, which is fine
    if (!text.includes("createAccountAlreadyExist")) {
      throw new Error(`Friendbot failed for ${publicKey}: ${text}`);
    }
  }
}

async function addUsdcTrustline(keypair: Keypair): Promise<void> {
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(keypair.publicKey());

  const usdc = new Asset("USDC", USDC_ISSUER);

  // Check if trustline already exists
  const hasTrustline = account.balances.some(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );

  if (hasTrustline) {
    console.log(`  ✓ USDC trustline already exists for ${keypair.publicKey().slice(0, 8)}...`);
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);
  recordStellarSubmit("change_trust");
  const _start = Date.now();
  try {
    await server.submitTransaction(tx);
    recordStellarResult("change_trust", "success");
    recordStellarLatency("change_trust", Date.now() - _start);
  } catch (err: any) {
    const resultCode = err?.response?.data?.extras?.result_codes?.transaction ?? "unknown";
    recordStellarResult("change_trust", resultCode);
    recordStellarLatency("change_trust", Date.now() - _start);
    throw err;
  }
  console.log(`  ✓ USDC trustline added for ${keypair.publicKey().slice(0, 8)}...`);
}

async function main() {
  console.log("=== CareGuard Wallet Setup ===\n");

  const wallets: WalletInfo[] = [
    { name: "AGENT", ...generateKeypair() },
    { name: "CAREGIVER", ...generateKeypair() },
    { name: "PHARMACY_1", ...generateKeypair() },
    { name: "PHARMACY_2", ...generateKeypair() },
    { name: "PHARMACY_3", ...generateKeypair() },
    { name: "BILL_PROVIDER", ...generateKeypair() },
  ];

  // Step 1: Fund all accounts
  console.log("Step 1: Funding accounts via Friendbot...\n");
  for (const wallet of wallets) {
    try {
      await fundAccount(wallet.publicKey);
      console.log(`  ✓ Funded ${wallet.name}: ${wallet.publicKey.slice(0, 8)}...`);
    } catch (err: any) {
      console.error(`  ✗ Failed to fund ${wallet.name}: ${err.message}`);
    }
  }

  // Step 2: Add USDC trustlines
  console.log("\nStep 2: Adding USDC trustlines...\n");
  for (const wallet of wallets) {
    try {
      const keypair = Keypair.fromSecret(wallet.secretKey);
      await addUsdcTrustline(keypair);
    } catch (err: any) {
      console.error(`  ✗ Failed trustline for ${wallet.name}: ${err.message}`);
    }
  }

  // Step 3: Output .env values
  console.log("\n=== Add these to your .env file ===\n");
  for (const wallet of wallets) {
    console.log(`${wallet.name}_SECRET_KEY=${wallet.secretKey}`);
    console.log(`${wallet.name}_PUBLIC_KEY=${wallet.publicKey}`);
  }

  console.log(`\n# USDC Testnet`);
  console.log(`USDC_ISSUER=${USDC_ISSUER}`);

  console.log(`\n=== IMPORTANT ===`);
  console.log(`Now get testnet USDC for the AGENT wallet:`);
  console.log(`1. Go to https://faucet.circle.com`);
  console.log(`2. Select "Stellar Testnet"`);
  console.log(`3. Paste the AGENT public key: ${wallets[0].publicKey}`);
  console.log(`4. Request USDC (you'll get 100 USDC)`);
  console.log(`\nAlso fund the CAREGIVER wallet with USDC for testing.`);
}

function generateKeypair(): { publicKey: string; secretKey: string } {
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secretKey: kp.secret() };
}

export { main, fundAccount, addUsdcTrustline, generateKeypair };

if (!process.env.VITEST) {
  main().catch(console.error);
}
