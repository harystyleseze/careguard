/**
 * Medical Bill Audit API — x402-protected on Stellar
 *
 * Every audit requires a real x402 payment in USDC via the OZ Facilitator.
 * POST /bill/audit — $0.01 per audit
 *
 * Fair market rate database based on Medicare reimbursement rates (CMS 2026 fee schedule).
 */

if (!process.stdout.isTTY) {
  process.env.NO_COLOR ??= "1";
  process.env.FORCE_COLOR = "0";
}

import "dotenv/config";
import express from "express";
import { readFileSync } from "fs";
import {
  BillAuditValidationError,
  createBillAuditMaxItemsMiddleware,
  type LineItem,
  validateBillAuditRequest,
} from "../../shared/bill-audit.ts";
import { applyX402Middleware, NETWORK, OZ_FACILITATOR_URL } from "../../shared/x402-middleware.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestContextMiddleware } from "../../shared/request-context.ts";
import { requestLoggerMiddleware } from "../../shared/request-logger.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import { billAuditOversizedRejectionsTotal } from "../../shared/metrics.ts";

const PORT = parseInt(process.env.BILL_AUDIT_API_PORT || "3002");
const PAY_TO = process.env.BILL_PROVIDER_PUBLIC_KEY;

if (!PAY_TO) throw new Error("BILL_PROVIDER_PUBLIC_KEY required in .env");

// Duplicate detection allowlist configuration
interface DuplicateAllowlistEntry {
  code: string;
  reason: string;
  addedBy: string;
  addedAt: string;
  facilityId?: string; // Optional: per-facility override
}

let duplicateAllowlist: Set<string> = new Set();
let allowlistMetadata: Map<string, DuplicateAllowlistEntry> = new Map();

function loadDuplicateAllowlist() {
  try {
    const allowlistPath = new URL('./duplicates-allowlist.json', import.meta.url).pathname;
    const data = JSON.parse(readFileSync(allowlistPath, 'utf-8')) as DuplicateAllowlistEntry[];
    
    duplicateAllowlist = new Set(data.map(entry => entry.code));
    allowlistMetadata = new Map(data.map(entry => [entry.code, entry]));
    
    logger.info({ count: duplicateAllowlist.size, codes: Array.from(duplicateAllowlist) }, 'Loaded duplicate detection allowlist');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to load duplicates-allowlist.json, using empty allowlist');
    duplicateAllowlist = new Set();
    allowlistMetadata = new Map();
  }
}

// Load allowlist at boot
loadDuplicateAllowlist();

// Reload allowlist on SIGHUP
process.on('SIGHUP', () => {
  logger.info('SIGHUP received, reloading duplicate allowlist');
  loadDuplicateAllowlist();
});

// Audit threshold configuration
export const BILL_AUDIT_OVERCHARGE_MULTIPLIER = parseFloat(process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER || "1.5");
export const BILL_AUDIT_SUGGESTED_MULTIPLIER = parseFloat(process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER || "1.2");
export const BILL_AUDIT_UPCODED_MULTIPLIER = parseFloat(process.env.BILL_AUDIT_UPCODED_MULTIPLIER || "3.0");

if (
  isNaN(BILL_AUDIT_OVERCHARGE_MULTIPLIER) ||
  isNaN(BILL_AUDIT_SUGGESTED_MULTIPLIER) ||
  isNaN(BILL_AUDIT_UPCODED_MULTIPLIER) ||
  !(BILL_AUDIT_UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER &&
    BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER &&
    BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0)
) {
  throw new Error("Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1.0");
}

interface AuditThresholdConfig {
  default: number;
  byCpt: Record<string, number>;
}

let auditThresholds: AuditThresholdConfig = { default: BILL_AUDIT_OVERCHARGE_MULTIPLIER, byCpt: {} };

function loadAuditThresholds() {
  try {
    const thresholdsPath = new URL('./audit_thresholds.json', import.meta.url).pathname;
    auditThresholds = JSON.parse(readFileSync(thresholdsPath, 'utf-8')) as AuditThresholdConfig;
    if (process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER) {
      auditThresholds.default = BILL_AUDIT_OVERCHARGE_MULTIPLIER;
    }
    logger.info({ default: auditThresholds.default, cptCount: Object.keys(auditThresholds.byCpt).length }, 'Loaded audit thresholds configuration');
  } catch (err: any) {
    logger.error({ err: err.message }, `Failed to load audit_thresholds.json, using default threshold of ${BILL_AUDIT_OVERCHARGE_MULTIPLIER}`);
    auditThresholds = { default: BILL_AUDIT_OVERCHARGE_MULTIPLIER, byCpt: {} };
  }
}

function getAuditThreshold(cptCode: string): number {
  return auditThresholds.byCpt[cptCode] ?? auditThresholds.default;
}

// Load thresholds at boot
loadAuditThresholds();

// Reload thresholds on SIGHUP
process.on('SIGHUP', () => {
  logger.info('SIGHUP received, reloading audit thresholds');
  loadAuditThresholds();
});

// Fair market rate database — based on CMS Medicare Physician Fee Schedule 2026
// Rates are valid through end of 2026. After this date, rates should be refreshed.
const RATES_AS_OF = '2026-01-01';
const RATES_VALID_UNTIL = '2026-12-31';

const FAIR_MARKET_RATES: Record<string, { description: string; fairRate: number }> = {
  "99213": { description: "Office visit, established patient, moderate", fairRate: 130 },
  "99214": { description: "Office visit, established patient, high", fairRate: 195 },
  "99215": { description: "Office visit, established patient, complex", fairRate: 265 },
  "70553": { description: "MRI brain with and without contrast", fairRate: 450 },
  "71046": { description: "Chest X-ray, 2 views", fairRate: 45 },
  "80053": { description: "Comprehensive metabolic panel", fairRate: 25 },
  "85025": { description: "Complete blood count (CBC)", fairRate: 15 },
  "36415": { description: "Venipuncture (blood draw)", fairRate: 10 },
  "93000": { description: "Electrocardiogram (ECG)", fairRate: 35 },
  "99232": { description: "Hospital care, moderate complexity", fairRate: 145 },
  "99233": { description: "Hospital care, high complexity", fairRate: 210 },
  "99238": { description: "Hospital discharge day management", fairRate: 160 },
  "96372": { description: "Injection, subcutaneous or intramuscular", fairRate: 25 },
  "J0170": { description: "Adrenaline/epinephrine injection", fairRate: 15 },
  "97110": { description: "Physical therapy, therapeutic exercises", fairRate: 55 },
};

// Check if rates data is stale
function checkRatesFreshness() {
  const validUntil = new Date(RATES_VALID_UNTIL);
  const now = new Date();
  if (now > validUntil) {
    logger.warn({ ratesAsOf: RATES_AS_OF, validUntil: RATES_VALID_UNTIL, currentDate: now.toISOString() }, 'Fair market rates are stale. Please refresh rates from CMS fee schedule.');
  }
}

// Check freshness at boot
checkRatesFreshness();

interface BillItem { description: string; cptCode: string; quantity: number; chargedAmount: number; }

export function auditBill(lineItems: BillItem[]) {
  const results: any[] = [];
  let totalCharged = 0, totalCorrect = 0, errorCount = 0;
  const seenCodes: Record<string, number> = {};

  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fairRate = FAIR_MARKET_RATES[item.cptCode];
    const fairAmount = fairRate !== undefined ? fairRate.fairRate * item.quantity : null;
    const threshold = getAuditThreshold(item.cptCode);

    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (seenCodes[item.cptCode] > 1 && !duplicateAllowlist.has(item.cptCode)) {
      errorCount++;
      results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: "duplicate", errorDescription: `Duplicate charge for CPT ${item.cptCode}. Appears ${seenCodes[item.cptCode]} times.`, suggestedAmount: 0 });
      continue;
    }

    if (fairAmount !== null && item.chargedAmount > fairAmount * threshold) {
      errorCount++;
      const suggestedAmount = +(fairAmount * BILL_AUDIT_SUGGESTED_MULTIPLIER).toFixed(2);
      totalCorrect += suggestedAmount;
      results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: item.chargedAmount > fairAmount * BILL_AUDIT_UPCODED_MULTIPLIER ? "upcoded" : "overcharged", errorDescription: `Charged $${item.chargedAmount} — CMS fair market rate is $${fairAmount}. Overcharged by $${(item.chargedAmount - fairAmount).toFixed(2)}.`, suggestedAmount });
      continue;
    }

    const suggested = fairAmount !== null ? Math.min(item.chargedAmount, +(fairAmount * BILL_AUDIT_SUGGESTED_MULTIPLIER).toFixed(2)) : item.chargedAmount;
    totalCorrect += suggested;
    results.push({ description: item.description, cptCode: item.cptCode, quantity: item.quantity, chargedAmount: item.chargedAmount, fairMarketRate: fairAmount, status: "valid", errorDescription: null, suggestedAmount: suggested });
  }

  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);

  const savingsPercent = totalCharged > 0 ? +((totalOvercharge / totalCharged) * 100).toFixed(1) : 0;
  const now = new Date();
  const validUntil = new Date(RATES_VALID_UNTIL);
  const isStale = now > validUntil;

  return {
    auditTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.01", payTo: PAY_TO },
    totalCharged: +totalCharged.toFixed(2), totalCorrect: +totalCorrect.toFixed(2),
    totalOvercharge, savingsPercent, errorCount, lineItems: results,
    dataFreshness: { ratesAsOf: RATES_AS_OF, validUntil: RATES_VALID_UNTIL, isStale },
    recommendation: errorCount === 0 ? "No errors detected. This bill appears correct." : `Found ${errorCount} errors totaling $${totalOvercharge} in overcharges (${savingsPercent}% of total bill). Strongly recommend filing a formal dispute.`,
  };
}

const app = express();
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.BILL_AUDIT_BODY_LIMIT ?? "256kb" }));
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard Medical Bill Audit API", version: "1.0.0",
    protocol: "x402 on Stellar", network: NETWORK, payTo: PAY_TO, price: "$0.01 per audit",
  });
});

app.get("/bill/sample", (req, res) => {
  // In standalone mode the recipient DB is unavailable; accept a patientName hint from the caller.
  // In unified mode, server.ts intercepts this route and resolves the name from the recipients DB.
  const patientName = typeof req.query.patientName === 'string'
    ? req.query.patientName
    : 'Rosa Garcia';
  res.json({
    patientName, facilityName: "General Hospital", dateOfService: "2026-03-15",
    lineItems: [
      { description: "Hospital care, high complexity", cptCode: "99233", quantity: 3, chargedAmount: 630 },
      { description: "Comprehensive metabolic panel", cptCode: "80053", quantity: 1, chargedAmount: 95 },
      { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
      { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
      { description: "Venipuncture (blood draw)", cptCode: "36415", quantity: 1, chargedAmount: 10 },
      { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 1, chargedAmount: 180 },
      { description: "Electrocardiogram (ECG)", cptCode: "93000", quantity: 1, chargedAmount: 35 },
      { description: "Office visit, complex", cptCode: "99215", quantity: 1, chargedAmount: 1250 },
      { description: "Hospital discharge day", cptCode: "99238", quantity: 1, chargedAmount: 160 },
      { description: "Injection, subcutaneous", cptCode: "96372", quantity: 2, chargedAmount: 50 },
    ],
  });
});

const billAuditMaxItemsMiddleware = createBillAuditMaxItemsMiddleware({
  onReject: () => billAuditOversizedRejectionsTotal.inc(),
});

// Reject oversized bill audits before x402 settlement.
app.post("/bill/audit", billAuditMaxItemsMiddleware);

// x402 payment middleware
applyX402Middleware(app, {
  "POST /bill/audit": {
    accepts: { scheme: "exact", network: NETWORK, payTo: PAY_TO, price: "$0.01" },
    description: "Medical bill audit — $0.01 USDC",
  },
});

app.post("/bill/audit", (req, res) => {
  try {
    const validatedData = validateBillAuditRequest(req.body);
    const sanitizedLineItems = validatedData.lineItems.map((item) => ({
      ...item,
      description: sanitizeUserString(item.description),
    }));
    res.json(auditBill(sanitizedLineItems));
  } catch (error) {
    if (error instanceof BillAuditValidationError) {
      const validationError = error as BillAuditValidationError;
      res.status(400).json({
        ok: false,
        reason: validationError.code,
        message: validationError.message,
        issues: validationError.issues,
      });
    } else {
      res.status(400).json({ ok: false, reason: "INVALID_REQUEST_BODY" });
    }
  }
});

app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large", limit: err.limit });
  }
  next(err);
});

let isDraining = false;
app.get("/ready", (_req, res) => {
  if (isDraining) {
    res.status(503).send("Service Unavailable");
    return;
  }
  res.send("OK");
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, network: NETWORK, facilitator: OZ_FACILITATOR_URL, payTo: PAY_TO }, "Bill Audit API started");
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Draining server...");
  isDraining = true;
  server.close(() => {
    logger.info("Server closed. Exiting process.");
    process.exit(0);
  });
  setTimeout(() => {
    logger.error("Graceful shutdown timeout. Forcing exit.");
    process.exit(1);
  }, 30000);
});
