/**
 * Proactive Medication Price Watch & Alert Dispatcher (Issue #1236)
 *
 * Periodically re-runs compare_pharmacy_prices for recipients' recurring medications
 * and notifies caregivers via shared/notifications.ts when a materially cheaper price is found.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { comparePharmacyPrices, loadSpendingAsync } from "./tools.ts";
import { notify } from "../shared/notifications.ts";
import { logger } from "../shared/logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data");

export const PRICE_WATCH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface PriceAlertRecord {
  medication: string;
  pharmacy: string;
  price: number;
  savings: number;
  savingsPercent: number;
  alertedAt: string;
}

export type PriceWatchHistory = Record<string, PriceAlertRecord>;

export function getPriceWatchHistoryPath(recipientId: string = "rosa"): string {
  const dir = join(DATA_DIR, "recipients", recipientId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "price-watch-history.json");
}

export function loadPriceWatchHistory(recipientId: string = "rosa"): PriceWatchHistory {
  const filePath = getPriceWatchHistoryPath(recipientId);
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err: any) {
    logger.warn({ err: err?.message, recipientId }, "failed to read price watch history");
    return {};
  }
}

export function savePriceWatchHistory(
  history: PriceWatchHistory,
  recipientId: string = "rosa",
): void {
  const filePath = getPriceWatchHistoryPath(recipientId);
  writeFileSync(filePath, JSON.stringify(history, null, 2), "utf-8");
}

export interface PriceWatchResult {
  recipientId: string;
  checkedMeds: string[];
  alertsSent: PriceAlertRecord[];
  skippedOptOut: string[];
  skippedNoSavings: string[];
  timestamp: string;
}

/**
 * Runs a price-watch check for a care recipient's medications.
 * Time Complexity: O(M * P) where M is medications and P is pharmacies.
 * Space Complexity: O(M)
 */
export async function runPriceWatchForRecipient(
  recipientId: string = "rosa",
  medications?: string[],
  zipCode?: string,
): Promise<PriceWatchResult> {
  logger.info({ recipientId }, "[price-watch] checking recurring medications for price drops");
  const spending = await loadSpendingAsync(recipientId);
  const policy = spending.policy as any;
  const priceWatchConfig = policy?.priceWatch ?? {
    enabled: true,
    optOutMeds: [],
    minSavingsThreshold: 5.0,
    minSavingsPercent: 15,
  };

  if (priceWatchConfig.enabled === false) {
    logger.info({ recipientId }, "[price-watch] disabled in recipient policy, skipping");
    return {
      recipientId,
      checkedMeds: [],
      alertsSent: [],
      skippedOptOut: [],
      skippedNoSavings: [],
      timestamp: new Date().toISOString(),
    };
  }

  const optOutList: string[] = (priceWatchConfig.optOutMeds || []).map((m: string) =>
    m.toLowerCase().trim(),
  );
  const minSavingsUsd = priceWatchConfig.minSavingsThreshold ?? 5.0;
  const minSavingsPct = priceWatchConfig.minSavingsPercent ?? 15;

  // Default recurring medications if not provided
  const targetMeds = (medications && medications.length > 0)
    ? medications
    : ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"];

  const history = loadPriceWatchHistory(recipientId);
  const alertsSent: PriceAlertRecord[] = [];
  const skippedOptOut: string[] = [];
  const skippedNoSavings: string[] = [];
  const checkedMeds: string[] = [];
  const now = Date.now();

  for (const med of targetMeds) {
    const medKey = med.toLowerCase().trim();
    if (optOutList.includes(medKey)) {
      skippedOptOut.push(med);
      continue;
    }

    checkedMeds.push(med);
    try {
      const compareResult = await comparePharmacyPrices(med, zipCode);
      if (!compareResult || !compareResult.cheapest) {
        skippedNoSavings.push(med);
        continue;
      }

      const cheapest = compareResult.cheapest;
      const potentialSavings = compareResult.potentialSavings ?? 0;
      const savingsPercent = compareResult.savingsPercent ?? 0;

      // Meaningful savings evaluation to avoid alert spam
      const isMeaningful =
        potentialSavings >= minSavingsUsd && savingsPercent >= minSavingsPct;

      if (!isMeaningful) {
        skippedNoSavings.push(med);
        continue;
      }

      // Cooldown / deduplication evaluation
      const previousAlert = history[medKey];
      if (previousAlert) {
        const elapsed = now - new Date(previousAlert.alertedAt).getTime();
        // Skip if within cooldown period and price has not dropped further by at least $2
        if (elapsed < PRICE_WATCH_COOLDOWN_MS && cheapest.price >= previousAlert.price - 2.0) {
          logger.info(
            { med, elapsedDays: (elapsed / 86400000).toFixed(1) },
            "[price-watch] alert suppressed by cooldown window",
          );
          continue;
        }
      }

      // Dispatch alert via multi-channel notification dispatcher
      const alertRecord: PriceAlertRecord = {
        medication: med,
        pharmacy: cheapest.pharmacyName,
        price: cheapest.price,
        savings: potentialSavings,
        savingsPercent,
        alertedAt: new Date().toISOString(),
      };

      await notify({
        level: "info",
        title: `Price Drop: ${med} is $${potentialSavings.toFixed(2)} cheaper at ${cheapest.pharmacyName}`,
        description: `CareGuard price-watch found ${med} for $${cheapest.price.toFixed(2)} at ${cheapest.pharmacyName} — saving $${potentialSavings.toFixed(2)}/month (${savingsPercent}% discount).`,
        context: {
          recipientId,
          medication: med,
          pharmacy: cheapest.pharmacyName,
          price: cheapest.price,
          savings: potentialSavings,
          savingsPercent,
        },
      });

      alertsSent.push(alertRecord);
      history[medKey] = alertRecord;
    } catch (err: any) {
      logger.warn({ med, err: err?.message }, "[price-watch] error comparing prices for medication");
    }
  }

  if (alertsSent.length > 0) {
    savePriceWatchHistory(history, recipientId);
  }

  logger.info(
    { recipientId, checked: checkedMeds.length, alerts: alertsSent.length },
    "[price-watch] run completed",
  );

  return {
    recipientId,
    checkedMeds,
    alertsSent,
    skippedOptOut,
    skippedNoSavings,
    timestamp: new Date().toISOString(),
  };
}
