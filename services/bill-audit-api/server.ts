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
  FAIR_MARKET_RATES,
  auditBill as sharedAuditBill,
  type LineItem,
  validateBillAuditRequest,
} from "../../shared/bill-audit.ts";
import { getProviderBillHistoryStore } from "./history.ts";
import {
  applyX402Middleware,
  NETWORK,
  OZ_FACILITATOR_URL,
} from "../../shared/x402-verify-middleware.ts";
import { createCorsMiddleware } from "../../shared/cors.ts";
import { applySecurityMiddleware } from "../../shared/security-middleware.ts";
import { logger } from "../../shared/logger.ts";
import { requestLifecycleMiddleware } from "../../shared/request-lifecycle.ts";
import { gracefulShutdown } from "../../shared/graceful-shutdown.ts";
import { sanitizeUserString } from "../../shared/sanitize.ts";
import { billAuditOversizedRejectionsTotal } from "../../shared/metrics.ts";
import { extractLineItemsFromBillImage } from "../../shared/bill-ocr.ts";

const PORT = parseInt(process.env.BILL_AUDIT_API_PORT || "3002", 10);
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
let allowlistLoaded = false;

function loadDuplicateAllowlist() {
  try {
    const allowlistPath = new URL(
      "./duplicates-allowlist.json",
      import.meta.url,
    ).pathname;
    const data = JSON.parse(
      readFileSync(allowlistPath, "utf-8"),
    ) as DuplicateAllowlistEntry[];

    duplicateAllowlist = new Set(data.map((entry) => entry.code));
    allowlistMetadata = new Map(data.map((entry) => [entry.code, entry]));
    allowlistLoaded = true;

    logger.info(
      { count: duplicateAllowlist.size, codes: Array.from(duplicateAllowlist) },
      "Loaded duplicate detection allowlist",
    );
  } catch (err: any) {
    logger.error(
      { err: err.message },
      "Failed to load duplicates-allowlist.json, using empty allowlist",
    );
    duplicateAllowlist = new Set();
    allowlistMetadata = new Map();
    allowlistLoaded = false;
  }
}

// Load allowlist at boot
loadDuplicateAllowlist();

// Reload allowlist on SIGHUP
process.on("SIGHUP", () => {
  logger.info("SIGHUP received, reloading duplicate allowlist");
  loadDuplicateAllowlist();
});

// Audit threshold configuration
export const BILL_AUDIT_OVERCHARGE_MULTIPLIER = parseFloat(
  process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER || "1.5",
);
export const BILL_AUDIT_SUGGESTED_MULTIPLIER = parseFloat(
  process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER || "1.2",
);
export const BILL_AUDIT_UPCODED_MULTIPLIER = parseFloat(
  process.env.BILL_AUDIT_UPCODED_MULTIPLIER || "3.0",
);

if (
  isNaN(BILL_AUDIT_OVERCHARGE_MULTIPLIER) ||
  isNaN(BILL_AUDIT_SUGGESTED_MULTIPLIER) ||
  isNaN(BILL_AUDIT_UPCODED_MULTIPLIER) ||
  !(
    BILL_AUDIT_UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER &&
    BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER &&
    BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0
  )
) {
  throw new Error(
    "Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1.0",
  );
}

interface AuditThresholdConfig {
  default: number;
  byCpt: Record<string, number>;
}

let auditThresholds: AuditThresholdConfig = {
  default: BILL_AUDIT_OVERCHARGE_MULTIPLIER,
  byCpt: {},
};
let thresholdsLoaded = false;

function loadAuditThresholds() {
  try {
    const thresholdsPath = new URL("./audit_thresholds.json", import.meta.url)
      .pathname;
    auditThresholds = JSON.parse(
      readFileSync(thresholdsPath, "utf-8"),
    ) as AuditThresholdConfig;
    if (process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER) {
      auditThresholds.default = BILL_AUDIT_OVERCHARGE_MULTIPLIER;
    }
    thresholdsLoaded = true;
    logger.info(
      {
        default: auditThresholds.default,
        cptCount: Object.keys(auditThresholds.byCpt).length,
      },
      "Loaded audit thresholds configuration",
    );
  } catch (err: any) {
    logger.error(
      { err: err.message },
      `Failed to load audit_thresholds.json, using default threshold of ${BILL_AUDIT_OVERCHARGE_MULTIPLIER}`,
    );
    auditThresholds = { default: BILL_AUDIT_OVERCHARGE_MULTIPLIER, byCpt: {} };
    thresholdsLoaded = false;
  }
}

function getAuditThreshold(cptCode: string): number {
  return auditThresholds.byCpt[cptCode] ?? auditThresholds.default;
}

// Load thresholds at boot
loadAuditThresholds();

// Reload thresholds on SIGHUP
process.on("SIGHUP", () => {
  logger.info("SIGHUP received, reloading audit thresholds");
  loadAuditThresholds();
});

// Rates valid dates
const RATES_AS_OF = "2026-01-01";
const RATES_VALID_UNTIL = "2026-12-31";

export { FAIR_MARKET_RATES };

// Check if rates data is stale
function checkRatesFreshness() {
  const validUntil = new Date(RATES_VALID_UNTIL);
  const now = new Date();
  if (now > validUntil) {
    logger.warn(
      {
        ratesAsOf: RATES_AS_OF,
        validUntil: RATES_VALID_UNTIL,
        currentDate: now.toISOString(),
      },
      "Fair market rates are stale. Please refresh rates from CMS fee schedule.",
    );
  }
}

// Check freshness at boot, then daily — a long-running process that started
// before RATES_VALID_UNTIL would otherwise never notice the rates going stale.
const RATES_FRESHNESS_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
checkRatesFreshness();
const ratesFreshnessInterval = setInterval(
  checkRatesFreshness,
  RATES_FRESHNESS_CHECK_INTERVAL_MS,
);
ratesFreshnessInterval.unref();

interface BillItem {
  description: string;
  cptCode: string;
  quantity: number;
  chargedAmount: number;
}

export function auditBill(
  lineItems: BillItem[],
  options?: { providerId?: string; providerName?: string; recipientId?: string },
) {
  const historyStore = getProviderBillHistoryStore();
  let providerHistoryLookup;
  if (options?.providerId) {
    providerHistoryLookup = (cptCode: string, chargedAmount: number) => {
      return historyStore.compareAgainstHistory({
        providerId: options.providerId!,
        providerName: options.providerName,
        cptCode,
        currentChargedAmount: chargedAmount,
      });
    };
  }

  const result = sharedAuditBill(lineItems, {
    network: NETWORK,
    payTo: PAY_TO,
    duplicateAllowlist,
    getAuditThreshold,
    overchargeMultiplier: BILL_AUDIT_OVERCHARGE_MULTIPLIER,
    suggestedMultiplier: BILL_AUDIT_SUGGESTED_MULTIPLIER,
    upcodedMultiplier: BILL_AUDIT_UPCODED_MULTIPLIER,
    ratesAsOf: RATES_AS_OF,
    ratesValidUntil: RATES_VALID_UNTIL,
    providerHistoryLookup,
  });

  if (options?.providerId) {
    historyStore.recordBillCharges({
      providerId: options.providerId,
      providerName: options.providerName || "Healthcare Provider",
      recipientId: options.recipientId,
      lineItems,
    });
  }

  return result;
}

export const app = express();
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.BILL_AUDIT_BODY_LIMIT ?? "256kb" }));
app.use(requestLifecycleMiddleware());

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard Medical Bill Audit API",
    version: "1.0.0",
    protocol: "x402 on Stellar",
    network: NETWORK,
    payTo: PAY_TO,
    price: "$0.01 per audit",
  });
});

app.get("/bill/sample", (req, res) => {
  // In standalone mode the recipient DB is unavailable; accept a patientName hint from the caller.
  // In unified mode, server.ts intercepts this route and resolves the name from the recipients DB.
  const patientName =
    typeof req.query.patientName === "string"
      ? req.query.patientName
      : "Rosa Garcia";
  res.json({
    patientName,
    facilityName: "General Hospital",
    dateOfService: "2026-03-15",
    lineItems: [
      {
        description: "Hospital care, high complexity",
        cptCode: "99233",
        quantity: 3,
        chargedAmount: 630,
      },
      {
        description: "Comprehensive metabolic panel",
        cptCode: "80053",
        quantity: 1,
        chargedAmount: 95,
      },
      {
        description: "Complete blood count (CBC)",
        cptCode: "85025",
        quantity: 1,
        chargedAmount: 45,
      },
      {
        description: "Complete blood count (CBC)",
        cptCode: "85025",
        quantity: 1,
        chargedAmount: 45,
      },
      {
        description: "Venipuncture (blood draw)",
        cptCode: "36415",
        quantity: 1,
        chargedAmount: 10,
      },
      {
        description: "Chest X-ray, 2 views",
        cptCode: "71046",
        quantity: 1,
        chargedAmount: 180,
      },
      {
        description: "Electrocardiogram (ECG)",
        cptCode: "93000",
        quantity: 1,
        chargedAmount: 35,
      },
      {
        description: "Office visit, complex",
        cptCode: "99215",
        quantity: 1,
        chargedAmount: 1250,
      },
      {
        description: "Hospital discharge day",
        cptCode: "99238",
        quantity: 1,
        chargedAmount: 160,
      },
      {
        description: "Injection, subcutaneous",
        cptCode: "96372",
        quantity: 2,
        chargedAmount: 50,
      },
    ],
  });
});

// Reject oversized bill audit requests BEFORE x402 payment is charged (issue #13)
const BILL_AUDIT_MAX_ITEMS = parseInt(
  process.env.BILL_AUDIT_MAX_ITEMS || "500",
  10,
);
app.post("/bill/audit", (req, res, next) => {
  const items = req.body?.lineItems;
  if (Array.isArray(items) && items.length > BILL_AUDIT_MAX_ITEMS) {
    billAuditOversizedRejectionsTotal.inc();
    res.status(400).json({
      error: `lineItems exceeds max (${BILL_AUDIT_MAX_ITEMS})`,
      code: "VALIDATION_ERROR",
    });
    return;
  }
  next();
});

// x402 payment middleware
applyX402Middleware(app, {
  "POST /bill/audit": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: PAY_TO,
      price: "$0.01",
    },
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
    res.json(
      auditBill(sanitizedLineItems, {
        providerId: validatedData.providerId,
        providerName: validatedData.providerName,
        recipientId: validatedData.recipientId,
      }),
    );
  } catch (error) {
    if (error instanceof BillAuditValidationError) {
      const validationError = error as BillAuditValidationError;
      res.status(400).json({
        error: validationError.message,
        code: validationError.code,
        details: { issues: validationError.issues },
      });
    } else {
      res.status(400).json({
        error: "Invalid request body",
        code: "INVALID_REQUEST_BODY",
      });
    }
  }
});

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err.type === "entity.too.large") {
      return res.status(413).json({
        error: "Request body too large",
        code: "BODY_TOO_LARGE",
        details: { limit: err.limit },
      });
    }
    next(err);
  },
);

// --- Bill OCR endpoint (#1229) ---
app.post("/bill/ocr", async (req, res) => {
  const { image } = req.body ?? {};
  if (!image || typeof image !== "string") {
    return res.status(400).json({ error: "image (base64) is required" });
  }
  try {
    const result = await extractLineItemsFromBillImage(image);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "OCR extraction failed" });
  }
});

let isDraining = false;
app.get("/ready", (_req, res) => {
  if (isDraining) {
    res.status(503).send("Service Unavailable");
    return;
  }
  if (!thresholdsLoaded || !allowlistLoaded) {
    res.status(503).json({
      status: "degraded",
      checks: { thresholdsLoaded, allowlistLoaded },
    });
    return;
  }
  res.send("OK");
});

export const server = app.listen(PORT, () => {
  logger.info(
    {
      port: PORT,
      network: NETWORK,
      facilitator: OZ_FACILITATOR_URL,
      payTo: PAY_TO,
    },
    "Bill Audit API started",
  );
});

gracefulShutdown({
  server,
  onDrainStart: () => {
    isDraining = true;
  },
});
