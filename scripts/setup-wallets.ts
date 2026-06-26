/**
 * Setup script: Creates and funds Stellar testnet wallets for CareGuard
 *
 * Creates wallets for: agent, caregiver, 3 pharmacies, bill provider
 * Funds each with XLM via Friendbot, creates USDC trustlines
 */

import { Keypair, Networks, TransactionBuilder, Operation, Asset, Horizon } from "@stellar/stellar-sdk";
import { createHash, createHmac } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { logger } from "../shared/logger.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const DEV_SEED_FILE = ".dev-seed";
export const WALLET_NAMES = [
  "AGENT",
  "CAREGIVER",
  "PHARMACY_1",
  "PHARMACY_2",
  "PHARMACY_3",
  "BILL_PROVIDER",
] as const;
const HARDENED_OFFSET = 0x80000000;
const STELLAR_DERIVATION_PATH = [44, 148] as const;
const GENERATED_MNEMONIC_STRENGTH = 256;

export interface WalletInfo {
  name: string;
  publicKey: string;
  secretKey: string;
}

function normalizeSeedMaterial(seedMaterial: string) {
  return seedMaterial.trim().normalize("NFKD").split(/\s+/).join(" ");
}

export function isMnemonicSeed(seedMaterial: string) {
  return validateMnemonic(normalizeSeedMaterial(seedMaterial), englishWordlist);
}

function deriveLegacyWalletsFromSeed(seedMaterial: string): WalletInfo[] {
  return WALLET_NAMES.map((name, index) => {
    const rawSeed = createHash("sha256")
      .update(seedMaterial)
      .update(":")
      .update(name)
      .update(":")
      .update(String(index))
      .digest();
    const keypair = Keypair.fromRawEd25519Seed(rawSeed);
    return {
      name,
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
    };
  });
}

function hardenedIndex(index: number) {
  return index + HARDENED_OFFSET;
}

function serializeIndex(index: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(index);
  return buffer;
}

function deriveSlip10Seed(masterSeed: Uint8Array, index: number) {
  let hmac = createHmac("sha512", "ed25519 seed");
  hmac.update(masterSeed);
  let result = hmac.digest();
  let privateKey = result.subarray(0, 32);
  let chainCode = result.subarray(32);

  for (const segment of [...STELLAR_DERIVATION_PATH, index]) {
    const data = Buffer.concat([
      Buffer.from([0]),
      privateKey,
      serializeIndex(hardenedIndex(segment)),
    ]);
    hmac = createHmac("sha512", chainCode);
    hmac.update(data);
    result = hmac.digest();
    privateKey = result.subarray(0, 32);
    chainCode = result.subarray(32);
  }

  return privateKey;
}

function deriveWalletsFromMnemonic(mnemonic: string): WalletInfo[] {
  const normalizedMnemonic = normalizeSeedMaterial(mnemonic);
  const masterSeed = mnemonicToSeedSync(normalizedMnemonic);

  return WALLET_NAMES.map((name, index) => {
    const rawSeed = deriveSlip10Seed(masterSeed, index);
    const keypair = Keypair.fromRawEd25519Seed(rawSeed);
    return {
      name,
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
    };
  });
}

export function deriveWalletsFromSeed(seedMaterial: string): WalletInfo[] {
  if (isMnemonicSeed(seedMaterial)) {
    return deriveWalletsFromMnemonic(seedMaterial);
  }

  return deriveLegacyWalletsFromSeed(seedMaterial);
}

async function confirmDevSeedGeneration(): Promise<boolean> {
  process.stdout.write(
    `No setup seed was provided and ${DEV_SEED_FILE} does not exist. Generate and persist a new dev seed? (y/N) `,
  );
  const answer = await new Promise<string>((resolve) => {
    process.stdin.once("data", (data) => resolve(data.toString().trim().toLowerCase()));
  });
  return answer === "y" || answer === "yes";
}

export async function resolveSetupSeed(options: {
  cwd?: string;
  seed?: string;
  yes?: boolean;
  confirmGenerate?: () => Promise<boolean>;
} = {}): Promise<{ seed: string; source: "provided" | "file" | "generated"; path?: string }> {
  const providedSeed = options.seed || process.env.DEV_WALLET_SEED;
  if (providedSeed) {
    return { seed: providedSeed, source: "provided" };
  }

  const cwd = options.cwd || process.cwd();
  const seedPath = path.join(cwd, DEV_SEED_FILE);
  if (existsSync(seedPath)) {
    return {
      seed: readFileSync(seedPath, "utf-8").trim(),
      source: "file",
      path: seedPath,
    };
  }

  const confirmed =
    options.yes || (await (options.confirmGenerate || confirmDevSeedGeneration)());
  if (!confirmed) {
    throw new Error(
      `Aborted: pass --seed=<value>, set DEV_WALLET_SEED, or approve ${DEV_SEED_FILE} creation.`,
    );
  }

  const seed = generateMnemonic(englishWordlist, GENERATED_MNEMONIC_STRENGTH);
  writeFileSync(seedPath, `${seed}\n`, { mode: 0o600 });
  return { seed, source: "generated", path: seedPath };
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
    logger.info({ wallet: keypair.publicKey().slice(0, 8) }, "USDC trustline already exists");
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
  await server.submitTransaction(tx);
  logger.info({ wallet: keypair.publicKey().slice(0, 8) }, "USDC trustline added");
}

async function main() {
  const writeEnv = process.argv.includes("--write-env");
  const yes = process.argv.includes("--yes");
  const seedArg = process.argv
    .find((arg) => arg.startsWith("--seed="))
    ?.slice("--seed=".length);
  logger.info("CareGuard Wallet Setup starting");

  const seed = await resolveSetupSeed({ seed: seedArg, yes });
  if (seed.source === "generated") {
    logger.info({ path: seed.path }, "generated setup seed");
  } else {
    logger.info({ source: seed.source }, "using setup seed");
  }

  if (!isMnemonicSeed(seed.seed)) {
    logger.warn(
      "using legacy non-mnemonic setup seed; recovery via BIP-39 mnemonic is unavailable until you replace .dev-seed or pass --seed",
    );
  }

  const wallets = deriveWalletsFromSeed(seed.seed);

  logger.info("step 1: funding accounts via Friendbot");
  for (const wallet of wallets) {
    try {
      await fundAccount(wallet.publicKey);
      logger.info({ name: wallet.name, wallet: wallet.publicKey.slice(0, 8) }, "funded");
    } catch (err: any) {
      logger.error({ name: wallet.name, err: err.message }, "failed to fund wallet");
    }
  }

  logger.info("step 2: adding USDC trustlines");
  for (const wallet of wallets) {
    try {
      const keypair = Keypair.fromSecret(wallet.secretKey);
      await addUsdcTrustline(keypair);
    } catch (err: any) {
      logger.error({ name: wallet.name, err: err.message }, "failed to add trustline");
    }
  }

  // Step 3: Output .env values — written directly so they are copy-pasteable
  const envLines: string[] = [];
  for (const wallet of wallets) {
    envLines.push(`${wallet.name}_SECRET_KEY=${wallet.secretKey}`);
    envLines.push(`${wallet.name}_PUBLIC_KEY=${wallet.publicKey}`);
  }
  envLines.push(`\n# USDC Testnet\nUSDC_ISSUER=${USDC_ISSUER}`);

  if (writeEnv) {
    const confirmMsg = "Write these values to .env in the current directory? (y/N) ";
    process.stdout.write(confirmMsg);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.once("data", (data) => resolve(data.toString().trim().toLowerCase()));
    });
    if (answer === "y" || answer === "yes") {
      const fs = await import("fs");
      const existing = fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : "";
      const updated = existing + (existing.endsWith("\n") ? "" : "\n") + envLines.join("\n") + "\n";
      fs.writeFileSync(".env", updated);
      logger.info(".env file updated");
    } else {
      logger.info("Skipped writing .env");
    }
  }

  process.stdout.write("\n=== Add these to your .env file ===\n\n");
  for (const line of envLines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(`\n=== IMPORTANT ===\nNow get testnet USDC for the AGENT wallet:\n`);
  process.stdout.write(`1. Go to https://faucet.circle.com\n2. Select "Stellar Testnet"\n`);
  process.stdout.write(`3. Paste the AGENT public key: ${wallets[0].publicKey}\n`);
  process.stdout.write(`4. Request USDC (you'll get 100 USDC)\n\nAlso fund the CAREGIVER wallet with USDC for testing.\n`);
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  main().catch((err) => { logger.error({ err: err?.message ?? err }, "setup failed"); process.exit(1); });
}
