#!/usr/bin/env node
/**
 * Wallet low-balance check — runnable on cron.
 *
 * Loads the agent wallet, compares USDC/XLM against thresholds, and on
 * breach: pauses the agent (in-process state — only effective when run as
 * the same process as the server) plus sends a notification and writes an
 * audit log entry.
 *
 * Also prints a clean balance summary table across all 6 CareGuard wallets.
 *
 * Usage:
 *   npm run wallet:check
 *   # or via cron (e.g. crontab):
 *   #   *\/15 * * * * cd /app && npm run wallet:check >> /var/log/wallet.log 2>&1
 */

import "dotenv/config";
import path from "path";
import { pathToFileURL } from "url";
import { Keypair } from "@stellar/stellar-sdk";
import {
  checkWalletBalance,
  formatResult,
  fetchWalletBalances,
  getThresholds,
  type WalletCheckOptions,
} from "../shared/wallet-balance.ts";
import { logger } from "../shared/logger.ts";
import { resolveStellarNetwork } from "../shared/stellar-network.ts";

export const WALLET_CONFIGS = [
  { name: "AGENT", envPublic: "AGENT_PUBLIC_KEY", envSecret: "AGENT_SECRET_KEY" },
  { name: "CAREGIVER", envPublic: "CAREGIVER_PUBLIC_KEY", envSecret: "CAREGIVER_SECRET_KEY" },
  { name: "PHARMACY_1", envPublic: "PHARMACY_1_PUBLIC_KEY", envSecret: "PHARMACY_1_SECRET_KEY" },
  { name: "PHARMACY_2", envPublic: "PHARMACY_2_PUBLIC_KEY", envSecret: "PHARMACY_2_SECRET_KEY" },
  { name: "PHARMACY_3", envPublic: "PHARMACY_3_PUBLIC_KEY", envSecret: "PHARMACY_3_SECRET_KEY" },
  { name: "BILL_PROVIDER", envPublic: "BILL_PROVIDER_PUBLIC_KEY", envSecret: "BILL_PROVIDER_SECRET_KEY" },
] as const;

export interface WalletTableRow {
  name: string;
  publicKey: string | null;
  xlm: number | null;
  usdc: number | null;
  error?: string;
}

export function truncateKey(pubKey: string | null): string {
  if (!pubKey) return "NOT CONFIGURED";
  if (pubKey.length <= 12) return pubKey;
  return `${pubKey.slice(0, 4)}...${pubKey.slice(-4)}`;
}

export function formatWalletTable(
  rows: WalletTableRow[],
  thresholds: { usdc: number; xlm: number },
): string {
  const lines: string[] = [];
  lines.push("\nCareGuard Wallet Balances:");
  lines.push("─".repeat(70));
  lines.push(
    "Wallet".padEnd(16) +
      "Public Key".padEnd(16) +
      "XLM Balance".padEnd(18) +
      "USDC Balance".padEnd(18),
  );
  lines.push("─".repeat(70));

  for (const row of rows) {
    const nameStr = row.name.padEnd(16);
    const keyStr = truncateKey(row.publicKey).padEnd(16);

    let xlmText: string;
    if (row.xlm === null) {
      xlmText = (row.error ? "ERROR" : "N/A").padEnd(18);
    } else {
      const formatted = row.xlm.toFixed(2);
      if (row.xlm < thresholds.xlm) {
        xlmText = `\x1b[31m${formatted} (LOW)\x1b[0m`.padEnd(18 + 9);
      } else {
        xlmText = formatted.padEnd(18);
      }
    }

    let usdcText: string;
    if (row.usdc === null) {
      usdcText = (row.error ? "ERROR" : "N/A").padEnd(18);
    } else {
      const formatted = row.usdc.toFixed(2);
      if (row.usdc < thresholds.usdc) {
        usdcText = `\x1b[31m${formatted} (LOW)\x1b[0m`.padEnd(18 + 9);
      } else {
        usdcText = formatted.padEnd(18);
      }
    }

    lines.push(`${nameStr}${keyStr}${xlmText}${usdcText}`);
  }
  lines.push("─".repeat(70) + "\n");
  return lines.join("\n");
}

export async function fetchAllWalletBalances(
  opts: WalletCheckOptions = {},
): Promise<WalletTableRow[]> {
  const horizonUrl = opts.horizonUrl ?? resolveStellarNetwork().horizonUrl;
  const usdcIssuer =
    opts.usdcIssuer ??
    process.env.USDC_ISSUER ??
    "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  const rows: WalletTableRow[] = [];

  for (const config of WALLET_CONFIGS) {
    let pubKey = process.env[config.envPublic]?.trim() || null;

    if (!pubKey && process.env[config.envSecret]?.trim()) {
      try {
        pubKey = Keypair.fromSecret(process.env[config.envSecret]!.trim()).publicKey();
      } catch {
        pubKey = null;
      }
    }

    if (!pubKey) {
      rows.push({ name: config.name, publicKey: null, xlm: null, usdc: null });
      continue;
    }

    try {
      const loadBalances =
        opts.loadBalances ??
        ((addr: string) => fetchWalletBalances(addr, horizonUrl, usdcIssuer));
      const snapshot = await loadBalances(pubKey);
      rows.push({
        name: config.name,
        publicKey: pubKey,
        xlm: snapshot.xlm,
        usdc: snapshot.usdc,
      });
    } catch (err: any) {
      rows.push({
        name: config.name,
        publicKey: pubKey,
        xlm: null,
        usdc: null,
        error: err?.message ?? "Failed to load",
      });
    }
  }

  return rows;
}

export async function runWalletCheck(opts: WalletCheckOptions = {}): Promise<void> {
  const result = await checkWalletBalance(opts);
  logger.info({ result: formatResult(result) }, "wallet check");

  const thresholds = getThresholds(opts);
  const rows = await fetchAllWalletBalances(opts);
  const tableOutput = formatWalletTable(rows, thresholds);
  console.log(tableOutput);

  if (result.action === "error") {
    process.exit(1);
  }
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  runWalletCheck().catch((err) => {
    logger.error({ err: err?.message ?? err }, "wallet check crashed");
    process.exit(1);
  });
}

