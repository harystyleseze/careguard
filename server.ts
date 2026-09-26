/**
 * CareGuard Unified Server — All services on one port for production deployment.
 *
 * Mounts: Pharmacy API, Bill Audit API, Drug Interaction API, Pharmacy Payment (MPP),
 * and AI Agent — all on a single Express app.
 *
 * For local dev: use `npm run dev` (separate processes)
 * For production: use `npm start` (this file)
 */

import "dotenv/config";
import express, { type Express } from "express";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import OpenAI from "openai";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
} from "fs";
import { fileURLToPath } from "url";
import lock from "proper-lockfile";
import { z } from "zod";

// x402 middleware
import { applyX402Middleware } from "./shared/x402-verify-middleware.ts";
import { createCorsMiddleware } from "./shared/cors.ts";
import { applySecurityMiddleware } from "./shared/security-middleware.ts";
import { createApiDocsRouter } from "./shared/api-docs.ts";
import { logger } from "./shared/logger.ts";
import { requireApiKey } from "./shared/auth.ts";
import { createPharmacyAdminAuth } from "./shared/pharmacy-admin-auth.ts";
import {
  validateTask,
  getSuspiciousTaskCount,
} from "./shared/task-validation.ts";
import {
  BillAuditValidationError,
  FAIR_MARKET_RATES,
  auditBill,
  validateBillAuditRequest,
} from "./shared/bill-audit.ts";
import { sanitizeUserString } from "./shared/sanitize.ts";
import { registerKnownNames } from "./shared/redact.ts";

// Sentry (gated by SENTRY_DSN)
import { initSentry } from "./shared/sentry.ts";

// Observability
import { requestLifecycleMiddleware } from "./shared/request-lifecycle.ts";
import { gracefulShutdown } from "./shared/graceful-shutdown.ts";
import {
  metricsHandler,
  agentRunsTotal,
  agentToolCallsTotal,
  pharmacyUnknownDrugTotal,
  billAuditOversizedRejectionsTotal,
} from "./shared/metrics.ts";

// Shared agent pause state + wallet low-balance scheduler
import {
  getAgentState,
  pauseAgent,
  resumeAgent,
  isPaused,
  type PauseReason,
} from "./shared/agent-state.ts";
import { checkWalletBalance, formatResult, fetchWalletBalances } from "./shared/wallet-balance.ts";
import { appendAuditEntry, auditRouter } from "./shared/audit-log.ts";
import {
  rateLimiters,
  perRouteLimiters,
  concurrentRequestsMiddleware,
} from "./shared/rate-limit.ts";
import { agentQueue } from "./shared/agent-queue.ts";
import { paginateTransactions } from "./shared/transaction-pagination.ts";

// Agent tools
import {
  payForMedication,
  payBill,
  checkSpendingPolicy,
  getSpendingSummary,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  SpendingPolicySchema,
} from "./agent/tools.ts";
import { executeTool, runAgent } from "./agent/runner.ts";
import { resolveRequestedDosage } from "./services/pharmacy-api/dosage.ts";
import { createPharmacyPricingStore } from "./services/pharmacy-api/db.ts";
import {
  PRICING_DATABASE,
  getPharmacyPrices,
  getAvailableDrugs,
} from "./shared/pharmacy-pricing.ts";
import { createCareRecipientsStore } from "./services/care-recipients/db.ts";
import { createCareRecipientsRouter } from "./services/care-recipients/routes.ts";
import {
  buildCompareResponse,
  DrugRecordSchema,
  PharmacyCompareQuerySchema,
  PharmacyPriceSchema,
  PharmacyRecordSchema,
} from "./services/pharmacy-api/logic.ts";
import type {
  DrugRecordInput,
  PharmacyCompareQuery,
  PharmacyPriceInput,
  PharmacyRecordInput,
} from "./services/pharmacy-api/logic.ts";
import {
  checkInteractions as checkDrugInteractionsInService,
  DrugInteractionsQuerySchema,
} from "./services/drug-interaction-api/logic.ts";
import type { DrugInteractionsQuery } from "./services/drug-interaction-api/logic.ts";
import {
  MedicationOrderSchema,
  type MedicationOrderInput,
} from "./services/pharmacy-payment/validation.ts";

// --- Environment ---
const envSchema = z
  .object({
    PORT: z.coerce
      .number()
      .int()
      .min(1, "PORT must be >= 1")
      .max(65535, "PORT must be <= 65535")
      .default(3004),
    STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
    LLM_API_KEY: z.string().min(1, "LLM_API_KEY required"),
    AGENT_SECRET_KEY: z.string().min(1, "AGENT_SECRET_KEY required"),
    PHARMACY_1_PUBLIC_KEY: z.string().min(1, "PHARMACY_1_PUBLIC_KEY required"),
    BILL_PROVIDER_PUBLIC_KEY: z
      .string()
      .min(1, "BILL_PROVIDER_PUBLIC_KEY required"),
    MPP_SECRET_KEY: z.string().min(1, "MPP_SECRET_KEY required"),
    LLM_BASE_URL: z.string().min(1).optional(),
    LLM_MODEL: z.string().min(1).optional(),
    CAREGIVER_TOKEN: z.string().min(1, "CAREGIVER_TOKEN required"),
    AGENT_API_KEY: z.string().min(1).optional(),
    OZ_FACILITATOR_API_KEY: z.string().min(1).optional(),
    X402_FACILITATOR_URL: z.string().min(1).optional(),
    BILL_AUDIT_OVERCHARGE_MULTIPLIER: z.coerce.number().positive().default(1.5),
    BILL_AUDIT_SUGGESTED_MULTIPLIER: z.coerce.number().positive().default(1.2),
    BILL_AUDIT_UPCODED_MULTIPLIER: z.coerce.number().positive().default(3.0),
  })
  .refine(
    (data) => {
      return (
        data.BILL_AUDIT_UPCODED_MULTIPLIER >
          data.BILL_AUDIT_OVERCHARGE_MULTIPLIER &&
        data.BILL_AUDIT_OVERCHARGE_MULTIPLIER >
          data.BILL_AUDIT_SUGGESTED_MULTIPLIER &&
        data.BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0
      );
    },
    {
      message:
        "Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1.0",
      path: ["BILL_AUDIT_UPCODED_MULTIPLIER"],
    },
  );

const env = envSchema.safeParse(process.env);
if (!env.success) {
  process.stderr.write(
    env.error.issues
      .map((i) => `Missing/invalid env: ${i.path.join(".")} — ${i.message}`)
      .join("\n") + "\n",
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !process.env.AGENT_API_KEY) {
  process.stderr.write(
    "Missing/invalid env: AGENT_API_KEY — required in production\n",
  );
  process.exit(1);
}

if (env.data.STELLAR_NETWORK === "public" && !env.data.OZ_FACILITATOR_API_KEY) {
  process.stderr.write(
    "Missing/invalid env: OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public\n",
  );
  process.exit(1);
}

if (env.data.STELLAR_NETWORK !== "public" && !env.data.OZ_FACILITATOR_API_KEY) {
  logger.warn(
    "OZ_FACILITATOR_API_KEY not set — x402 routes will fail until configured",
  );
}

// Multi-pharmacy mode requires PHARMACY_2_PUBLIC_KEY (#195)
const MULTI_PHARMACY_MODE = process.env.MULTI_PHARMACY_MODE === "true";
if (MULTI_PHARMACY_MODE && !process.env.PHARMACY_2_PUBLIC_KEY) {
  process.stderr.write(
    "Missing/invalid env: PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true\n",
  );
  process.exit(1);
}

const PORT = env.data.PORT;
const LLM_BASE_URL = env.data.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = env.data.LLM_MODEL || "llama-3.3-70b-versatile";
const CAREGIVER_TOKEN = env.data.CAREGIVER_TOKEN;
const NETWORK = (
  env.data.STELLAR_NETWORK === "public" ? "stellar:public" : "stellar:testnet"
) as `${string}:${string}`;

const llm = new OpenAI({ apiKey: env.data.LLM_API_KEY, baseURL: LLM_BASE_URL });
const agentKeypair = Keypair.fromSecret(env.data.AGENT_SECRET_KEY);

// --- Per-run tool call cap (issue #90) ---
const MAX_TOOL_CALLS_PER_RUN = parseInt(
  process.env.MAX_TOOL_CALLS_PER_RUN || "30",
  10,
);
let toolCallCapHitsTotal = 0;

// --- Per-run iteration cap (default 15) ---
const MAX_AGENT_ITERATIONS = Math.max(
  1,
  parseInt(
    process.env.MAX_AGENT_ITERATIONS ||
      process.env.AGENT_MAX_ITERATIONS ||
      "15",
    10,
  ) || 15,
);

// --- Mutable profile (issue #79) ---
const _DEFAULT_PROFILE = {
  recipient: {
    name: "Rosa Garcia",
    age: 78,
    medications: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
    doctor: "Dr. Chen, General Hospital",
    insurance: "Medicare Part D",
  },
  caregiver: {
    name: "Maria Garcia",
    relationship: "Daughter",
    location: "Phoenix, AZ (800 miles from Rosa)",
    notifications: "Email + SMS",
  },
};
let _profileData = {
  recipient: {
    ..._DEFAULT_PROFILE.recipient,
    medications: [..._DEFAULT_PROFILE.recipient.medications],
  },
  caregiver: { ..._DEFAULT_PROFILE.caregiver },
};

// --- Express App ---
const app: Express = express();
let isDraining = false;

app.use("/agent", rateLimiters.agent);
app.use("/health", rateLimiters.health);
app.use(rateLimiters.default);
const sentry = await initSentry({ service: "careguard-server" });
app.use(sentry.requestHandler());
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
const _smallJson = express.json({
  limit: process.env.JSON_BODY_LIMIT ?? "20kb",
});
const _largeJson = express.json({
  limit: process.env.BILL_AUDIT_BODY_LIMIT ?? "256kb",
});
app.use((req, res, next) =>
  (req.path.startsWith("/bill/audit") ? _largeJson : _smallJson)(
    req,
    res,
    next,
  ),
);
app.use(requestLifecycleMiddleware());
app.use("/agent", requireApiKey);
app.use("/agent/audit", auditRouter);

// --- Prometheus metrics ---
app.get("/metrics", metricsHandler());

// --- API docs: GET /docs (Scalar UI) and GET /openapi.yml (raw spec) ---
app.use(createApiDocsRouter());

// --- Root info ---
app.get("/", (_req, res) => {
  const state = getAgentState();
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: NETWORK,
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    careRecipient: _profileData.recipient.name,
    caregiver: _profileData.caregiver.name,
    paused: state.paused,
    pausedReason: state.pausedReason,
    pausedAt: state.pausedAt,
    mode: "unified",
  });
});

let isDegradedMode = false;

export function isDegraded(): boolean {
  return isDegradedMode;
}

export function setDegradedMode(degraded: boolean): void {
  isDegradedMode = degraded;
}

export function requireNonDegradedMode(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (isDegradedMode) {
    res.status(503).json({
      error: "Service operating in degraded mode: Horizon unreachable at boot",
      degraded: true,
    });
    return;
  }
  next();
}

// --- Liveness probe — no I/O, always fast ---
app.get("/health", (_req, res) => {
  if (isDegradedMode) {
    res.status(200).json({ status: "degraded", degraded: true });
    return;
  }
  res.json({ status: "ok" });
});

// Cached flag set by x402 middleware on each successful facilitator interaction
let ozFacilitatorReachable = false;
export function setOzFacilitatorReachable(reachable: boolean) {
  ozFacilitatorReachable = reachable;
}

// --- Readiness probe — checks Horizon + OZ facilitator flag + required env ---
app.get("/ready", async (_req, res) => {
  if (isDraining) {
    res.status(503).send("Service Unavailable");
    return;
  }
  const checks: Record<string, boolean | string> = {};

  // 1. Required env vars
  const requiredEnv = [
    "LLM_API_KEY",
    "AGENT_SECRET_KEY",
    "MPP_SECRET_KEY",
    "CAREGIVER_TOKEN",
  ];
  const missingEnv = requiredEnv.filter((k) => !process.env[k]);
  checks.env =
    missingEnv.length === 0 ? true : `missing: ${missingEnv.join(", ")}`;

  // 2. Horizon ping
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const resp = await fetch("https://horizon-testnet.stellar.org", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    checks.horizon = resp.ok || resp.status < 500;
  } catch {
    checks.horizon = false;
  }

  // 3. OZ facilitator reachability (set by middleware on successful payment verification)
  checks.ozFacilitator =
    ozFacilitatorReachable || !env.data.OZ_FACILITATOR_API_KEY
      ? true
      : "not yet verified";

  const allOk = Object.values(checks).every((v) => v === true);
  res
    .status(allOk ? 200 : 503)
    .json({ status: allOk ? "ok" : "degraded", checks });
});

// --- Profile (issue #79) ---
app.get("/agent/profile", (_req, res) => {
  res.json(_profileData);
});

app.patch("/agent/profile", (req, res) => {
  const { recipient, caregiver } = req.body ?? {};
  if (recipient && typeof recipient === "object") {
    _profileData.recipient = { ..._profileData.recipient, ...recipient };
    if (recipient.name) {
      registerKnownNames([recipient.name]);
    }
    if (Array.isArray(recipient.medications)) {
      _profileData.recipient.medications = recipient.medications;
    }
  }
  if (caregiver && typeof caregiver === "object") {
    _profileData.caregiver = { ..._profileData.caregiver, ...caregiver };
    if (caregiver.name) {
      registerKnownNames([caregiver.name]);
    }
  }
  res.json(_profileData);
});

// ============================================================
// PHARMACY PRICE API (was port 3001)
// ============================================================

const PHARMACY_ADMIN_TOKEN =
  process.env.PHARMACY_ADMIN_TOKEN || CAREGIVER_TOKEN;
const pharmacyStore = createPharmacyPricingStore();
const recipientsStore = createCareRecipientsStore();

// Register default names and database names on server startup
registerKnownNames([_profileData.recipient.name, _profileData.caregiver.name]);
try {
  const dbRecipients = recipientsStore.list();
  registerKnownNames(dbRecipients.map((r) => r.name));
} catch (e) {
  // Ignore errors if DB is empty or not seeded yet
}

const requirePharmacyAdmin = createPharmacyAdminAuth(PHARMACY_ADMIN_TOKEN);

app.get("/pharmacy/drugs", (_req, res) => {
  const drugs = pharmacyStore.listDrugs();
  res.json({ count: drugs.length, drugs, provider: "sqlite" });
});

app.get("/pharmacy/pharmacies", (_req, res) => {
  res.json({ pharmacies: pharmacyStore.listPharmacies() });
});

app.post("/pharmacy/drugs", requirePharmacyAdmin, (req, res) => {
  const parsedBody = DrugRecordSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: parsedBody.error.issues[0]?.message ?? "Invalid drug payload",
    });
    return;
  }

  res.status(201).json({
    drug: pharmacyStore.upsertDrug(parsedBody.data as DrugRecordInput),
  });
});

app.put("/pharmacy/drugs/:drugName", requirePharmacyAdmin, (req, res) => {
  const drugName = Array.isArray(req.params.drugName)
    ? req.params.drugName[0]
    : req.params.drugName;
  const parsedBody = DrugRecordSchema.safeParse({
    ...req.body,
    name: drugName,
  });
  if (!parsedBody.success) {
    res.status(400).json({
      error: parsedBody.error.issues[0]?.message ?? "Invalid drug payload",
    });
    return;
  }

  res.json({
    drug: pharmacyStore.upsertDrug(parsedBody.data as DrugRecordInput),
  });
});

app.delete("/pharmacy/drugs/:drugName", requirePharmacyAdmin, (req, res) => {
  const drugName = Array.isArray(req.params.drugName)
    ? req.params.drugName[0]
    : req.params.drugName;
  if (!pharmacyStore.deleteDrug(drugName)) {
    res.status(404).json({ error: `Drug not found: ${drugName}` });
    return;
  }

  res.status(204).send();
});

app.post("/pharmacy/pharmacies", requirePharmacyAdmin, (req, res) => {
  const parsedBody = PharmacyRecordSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error: parsedBody.error.issues[0]?.message ?? "Invalid pharmacy payload",
    });
    return;
  }

  res.status(201).json({
    pharmacy: pharmacyStore.upsertPharmacy(
      parsedBody.data as PharmacyRecordInput,
    ),
  });
});

app.put(
  "/pharmacy/pharmacies/:pharmacyId",
  requirePharmacyAdmin,
  (req, res) => {
    const pharmacyId = Array.isArray(req.params.pharmacyId)
      ? req.params.pharmacyId[0]
      : req.params.pharmacyId;
    const parsedBody = PharmacyRecordSchema.safeParse({
      ...req.body,
      id: pharmacyId,
    });
    if (!parsedBody.success) {
      res.status(400).json({
        error:
          parsedBody.error.issues[0]?.message ?? "Invalid pharmacy payload",
      });
      return;
    }

    res.json({
      pharmacy: pharmacyStore.upsertPharmacy(
        parsedBody.data as PharmacyRecordInput,
      ),
    });
  },
);

app.delete(
  "/pharmacy/pharmacies/:pharmacyId",
  requirePharmacyAdmin,
  (req, res) => {
    const pharmacyId = Array.isArray(req.params.pharmacyId)
      ? req.params.pharmacyId[0]
      : req.params.pharmacyId;
    if (!pharmacyStore.deletePharmacy(pharmacyId)) {
      res.status(404).json({
        error: `Pharmacy not found: ${pharmacyId}`,
      });
      return;
    }

    res.status(204).send();
  },
);

app.post("/pharmacy/prices", requirePharmacyAdmin, (req, res) => {
  const parsedBody = PharmacyPriceSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({
      error:
        parsedBody.error.issues[0]?.message ?? "Invalid pharmacy price payload",
    });
    return;
  }

  try {
    res.json({
      price: pharmacyStore.upsertPrice(parsedBody.data as PharmacyPriceInput),
    });
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : "Unable to upsert price",
    });
  }
});

// x402 for pharmacy compare
applyX402Middleware(
  app,
  {
    "GET /pharmacy/compare": {
      accepts: {
        scheme: "exact",
        network: NETWORK,
        payTo: env.data.PHARMACY_1_PUBLIC_KEY,
        price: "$0.002",
      },
      description: "Pharmacy price comparison — $0.002 USDC",
    },
  },
  {
    network: NETWORK,
    apiKey: env.data.OZ_FACILITATOR_API_KEY,
    facilitatorUrl: env.data.X402_FACILITATOR_URL,
  },
);

app.get(
  "/pharmacy/compare",
  perRouteLimiters.pharmacyCompare,
  concurrentRequestsMiddleware("pharmacy_compare"),
  (req, res) => {
    const parsedQuery = PharmacyCompareQuerySchema.safeParse({
      drug: req.query.drug,
      dosage: req.query.dosage,
      zip: req.query.zip,
    });
    if (!parsedQuery.success) {
      res.status(400).json({
        error:
          parsedQuery.error.issues[0]?.message ??
          "Invalid pharmacy query parameters",
      });
      return;
    }

    const query = parsedQuery.data as PharmacyCompareQuery;
    const drug = query.drug.trim().toLowerCase();
    const dosage = resolveRequestedDosage(drug, query.dosage);

    try {
      const { prices, usedZipCode, isFallbackZip } = getPharmacyPrices(
        drug,
        query.zip,
      );
      res.json(
        buildCompareResponse({
          drug,
          dosage,
          zip: query.zip,
          usedZipCode,
          isFallbackZip,
          payTo: env.data.PHARMACY_1_PUBLIC_KEY,
          network: NETWORK,
          prices,
        }),
      );
    } catch (error) {
      pharmacyUnknownDrugTotal.inc({ drug });
      res.status(404).json({ ok: false, reason: "NO_PRICES_FOUND" });
    }
  },
);

// ============================================================
// BILL AUDIT API (was port 3002)
// ============================================================

app.get("/bill/sample", (req, res) => {
  const rid =
    typeof req.query.recipientId === "string"
      ? req.query.recipientId
      : "rosa_garcia";
  const recipient = recipientsStore.getById(rid);
  const patientName = recipient?.name ?? "Rosa Garcia";
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
    res
      .status(400)
      .json({ error: `lineItems exceeds max (${BILL_AUDIT_MAX_ITEMS})` });
    return;
  }
  next();
});

// x402 for bill audit
applyX402Middleware(app, {
  "POST /bill/audit": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: process.env.BILL_PROVIDER_PUBLIC_KEY!,
      price: "$0.01",
    },
    description: "Bill audit — $0.01 USDC",
  },
});

app.post(
  "/bill/audit",
  perRouteLimiters.billAudit,
  concurrentRequestsMiddleware("bill_audit"),
  (req, res) => {
    try {
      const validatedBody = validateBillAuditRequest(req.body);
      const sanitizedLineItems = validatedBody.lineItems.map((lineItem) => ({
        ...lineItem,
        description: sanitizeUserString(lineItem.description),
      }));
      res.json(
        auditBill(sanitizedLineItems, {
          network: NETWORK,
          payTo: process.env.BILL_PROVIDER_PUBLIC_KEY,
        }),
      );
    } catch (error) {
      if (error instanceof BillAuditValidationError) {
        const validationError = error as BillAuditValidationError;
        res.status(400).json({
          ok: false,
          reason: validationError.code,
          message: validationError.message,
          issues: validationError.issues,
        });
        return;
      }

      res.status(400).json({ ok: false, reason: "INVALID_REQUEST_BODY" });
    }
  },
);

// ============================================================
// DRUG INTERACTION API (was port 3003)
// ============================================================

// x402 for drug interactions
applyX402Middleware(app, {
  "GET /drug/interactions": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: MULTI_PHARMACY_MODE
        ? process.env.PHARMACY_2_PUBLIC_KEY!
        : env.data.PHARMACY_1_PUBLIC_KEY,
      price: "$0.001",
    },
    description: "Drug interaction check — $0.001 USDC",
  },
});

app.get(
  "/drug/interactions",
  perRouteLimiters.drugInteractions,
  concurrentRequestsMiddleware("drug_interactions"),
  (req, res) => {
    const parsedQuery = DrugInteractionsQuerySchema.safeParse({
      meds: req.query.meds,
    });
    if (!parsedQuery.success) {
      res.status(400).json({
        error:
          parsedQuery.error.issues[0]?.message ??
          "Invalid meds query parameter",
      });
      return;
    }

    const result = checkDrugInteractionsInService(
      (parsedQuery.data as DrugInteractionsQuery).medications,
    );
    res.json({
      checkTimestamp: new Date().toISOString(),
      protocol: { name: "x402", network: NETWORK, price: "$0.001" },
      ...result,
    });
  },
);

// ============================================================
// MPP PHARMACY PAYMENT (was port 3005)
// ============================================================

const DATA_DIR =
  process.env.DATA_DIR || fileURLToPath(new URL("./data", import.meta.url));
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
const MPP_STORE_FILE = `${DATA_DIR}/mpp-store.json`;
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function createMppStore(filePath: string) {
  const storeFactory = Store as typeof Store & {
    fileSystem?: (path: string) => ReturnType<typeof Store.memory>;
  };
  return storeFactory.fileSystem?.(filePath) ?? Store.memory();
}

function loadOrders(): any[] {
  if (!existsSync(ORDERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function saveOrder(order: any): Promise<void> {
  // Ensure the file exists before locking (proper-lockfile requires it)
  if (!existsSync(ORDERS_FILE)) {
    writeFileSync(ORDERS_FILE, "[]", "utf-8");
  }
  let release: (() => Promise<void>) | undefined;
  try {
    release = await lock.lock(ORDERS_FILE, { retries: 10, stale: 5000 });
    const orders = loadOrders();
    orders.push(order);
    const tempFile = `${ORDERS_FILE}.tmp-${Date.now()}`;
    writeFileSync(tempFile, JSON.stringify(orders, null, 2), "utf-8");
    renameSync(tempFile, ORDERS_FILE);
  } catch (err: any) {
    if (err?.code === "ELOCKED") {
      const e = new Error(
        "Order storage temporarily unavailable — lock timeout. Please retry.",
      );
      (e as any).status = 503;
      throw e;
    }
    throw err;
  } finally {
    if (release) {
      try {
        await release();
      } catch {}
    }
  }
}

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    stellar.charge({
      recipient: process.env.PHARMACY_1_PUBLIC_KEY!,
      currency: USDC_SAC_TESTNET,
      network:
        env.data.STELLAR_NETWORK === "public"
          ? "stellar:pubnet"
          : "stellar:testnet",
      store: createMppStore(MPP_STORE_FILE),
    }),
  ],
});

app.get("/pharmacy/orders", (_req, res) => {
  res.json({ orders: loadOrders() });
});

app.post(
  "/pharmacy/order",
  perRouteLimiters.pharmacyOrder,
  concurrentRequestsMiddleware("pharmacy_order"),
  async (req, res) => {
    const parsedOrder = MedicationOrderSchema.safeParse(req.body);
    if (!parsedOrder.success) {
      res.status(400).json({
        error: "Invalid order request",
        details: parsedOrder.error.issues.map((issue) => issue.message),
      });
      return;
    }

    const parsedOrderData = parsedOrder.data as MedicationOrderInput;
    const safeDrug = sanitizeUserString(parsedOrderData.drug);
    const safePharmacy = sanitizeUserString(parsedOrderData.pharmacy);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const e of value) headers.append(key, e);
      } else {
        headers.set(key, value);
      }
    }
    const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers,
    });
    const result = await mppx.charge({
      amount: parsedOrderData.amount.toFixed(2),
      description: `Medication: ${safeDrug} from ${safePharmacy}`,
    })(webReq);
    if (result.status === 402) {
      result.challenge.headers.forEach((v: string, k: string) =>
        res.setHeader(k, v),
      );
      res.status(402).send(await result.challenge.text());
      return;
    }
    const order = {
      id: `order-${Date.now()}`,
      drug: safeDrug,
      pharmacy: safePharmacy,
      amount: parsedOrderData.amount,
      status: "confirmed",
      timestamp: new Date().toISOString(),
      network: NETWORK,
      protocol: "MPP Charge",
    };
    try {
      await saveOrder(order);
    } catch (err: any) {
      if (err?.status === 503) {
        res.status(503).json({ error: err.message });
        return;
      }
      throw err;
    }
    const response = result.withReceipt(
      Response.json({
        success: true,
        order,
        message: `Payment settled. ${safeDrug} from ${safePharmacy} confirmed.`,
      }),
    );
    response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
    res.status(response.status).json(await response.json());
  },
);

// ============================================================
// CARE RECIPIENTS API
// ============================================================

app.use(createCareRecipientsRouter(recipientsStore, CAREGIVER_TOKEN));

// ============================================================
// AI AGENT
// ============================================================

// PHI scrubbing — active unless LLM_PII_SCRUB=false (e.g. provider has a BAA)
const _piiScrub = process.env.LLM_PII_SCRUB !== "false";

// Agent endpoints
app.get("/agent/status", (_req, res) => {
  res.json(getAgentState());
});
app.post("/agent/pause", (req, res) => {
  const raw = req.body?.reason;
  const reason: PauseReason =
    raw === "low-balance-usdc" || raw === "low-balance-xlm" ? raw : "manual";
  const state = pauseAgent(reason);
  appendAuditEntry({
    event: "agent.paused",
    actor: "api",
    details: { reason },
  });
  res.json(state);
});
app.post("/agent/resume", (_req, res) => {
  const prev = getAgentState();
  const state = resumeAgent();
  appendAuditEntry({
    event: "agent.resumed",
    actor: "api",
    details: { previousReason: prev.pausedReason },
  });
  res.json(state);
});
app.get("/agent/spending", (_req, res) => {
  res.json(getSpendingSummary());
});
app.get("/agent/transactions", (req, res) => {
  const tracker = getSpendingTracker();
  const { transactions, pagination } = paginateTransactions(
    tracker.transactions,
    req.query.limit,
    req.query.offset,
  );
  res.json({ ...tracker, transactions, pagination });
});
app.post("/agent/policy", (req, res) => {
  const result = SpendingPolicySchema.safeParse(req.body);
  if (!result.success) {
    return res
      .status(400)
      .json({ error: "Invalid policy", issues: result.error.issues });
  }
  setSpendingPolicy(result.data);
  appendAuditEntry({
    event: "agent.policy_updated",
    actor: "api",
    details: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      policy: result.data,
    },
  });
  res.json({ success: true, policy: result.data });
});
app.post("/agent/reset", (req, res) => {
  resetSpendingTracker();
  appendAuditEntry({
    event: "agent.reset",
    actor: "api",
    details: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    },
  });
  res.json({ success: true });
});

app.post(
  "/agent/run",
  perRouteLimiters.agentRun,
  concurrentRequestsMiddleware("agent_run"),
  async (req, res) => {
    const validation = validateTask(req.body?.task);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    if (isPaused()) {
      const state = getAgentState();
      res.status(409).json({ error: "Agent is paused", ...state });
      return;
    }
    const task = validation.task!;
    logger.info(
      { task, suspicious: validation.suspicious },
      "agent task received",
    );
    try {
      const result = await agentQueue.enqueue(
        () =>
          runAgent({
            task,
            profile: _profileData,
            llm,
            model: LLM_MODEL,
            maxIterations: MAX_AGENT_ITERATIONS,
            maxToolCallsPerRun: MAX_TOOL_CALLS_PER_RUN,
            piiScrub: _piiScrub,
          }),
        (queueWaitMs) => {
          res.setHeader("Server-Timing", `agent-queue;dur=${queueWaitMs.toFixed(2)}`);
        },
      );
      agentRunsTotal.inc({ status: "success" });
      logger.info(
        { toolCalls: result.toolCalls.length, truncated: result.truncated },
        "agent task complete",
      );
      res.json(result);
    } catch (err: any) {
      if (err.status === 429) {
        res
          .status(429)
          .set("Retry-After", String(err.retryAfter))
          .json({ error: err.message });
        return;
      }
      agentRunsTotal.inc({ status: "error" });
      res.status(500).json({ error: err.message });
    }
  },
);

// ============================================================
// START
// ============================================================

const horizonServer = new Horizon.Server("https://horizon-testnet.stellar.org");

// 413 handler — must be before Sentry so Sentry also captures it
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err.type === "entity.too.large") {
      return res
        .status(413)
        .json({ error: "Request body too large", limit: err.limit });
    }
    next(err);
  },
);

// Sentry error handler must be registered AFTER all routes
app.use(sentry.errorHandler());

// Export app for testing
export { app };

async function startWalletBalanceScheduler(): Promise<void> {
  if (process.env.WALLET_BALANCE_CHECK_ENABLED !== "1") return;
  const cronExpr = process.env.WALLET_BALANCE_CHECK_CRON || "*/15 * * * *";

  let cron: any;
  try {
    cron = await import("node-cron");
  } catch {
    logger.warn(
      "wallet scheduler enabled but node-cron not installed — falling back to setInterval(15m)",
    );
    setInterval(() => {
      checkWalletBalance().then((r) =>
        logger.info({ result: formatResult(r) }, "wallet check"),
      );
    }, 15 * 60_000);
    return;
  }

  if (!cron.validate?.(cronExpr)) {
    logger.warn(
      { cronExpr },
      "invalid WALLET_BALANCE_CHECK_CRON, falling back to */15 * * * *",
    );
  }
  const expr = cron.validate?.(cronExpr) ? cronExpr : "*/15 * * * *";

  cron.schedule(expr, async () => {
    const r = await checkWalletBalance();
    logger.info({ result: formatResult(r) }, "wallet check");
  });

  checkWalletBalance().then((r) =>
    logger.info({ result: formatResult(r) }, "wallet check startup"),
  );
  logger.info({ expr }, "wallet balance scheduler armed");
}

export async function bootAccountCheck(
  serverInstance: Horizon.Server = horizonServer,
  publicKey: string = agentKeypair.publicKey(),
  timeoutMs: number = 10000,
): Promise<{ success: boolean; usdcBalance: string }> {
  try {
    const fetchPromise = fetchWalletBalances(
      publicKey,
      STELLAR_CONFIG.horizonUrl,
      env.data.USDC_ISSUER || "",
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Horizon loadAccount timeout (10s)")),
        timeoutMs,
      ),
    );

    const balances = await Promise.race([fetchPromise, timeoutPromise]);
    const usdcBalance = balances.usdc.toFixed(2);
    isDegradedMode = false;
    return { success: true, usdcBalance };
  } catch (err: any) {
    logger.error(
      { err: err.message },
      "CRITICAL: Horizon loadAccount failed or timed out during boot — continuing in degraded mode",
    );
    isDegradedMode = true;
    return { success: false, usdcBalance: "unable to check" };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = app.listen(PORT, async () => {
    const { usdcBalance } = await bootAccountCheck();
    logger.info(
      {
        port: PORT,
        network: NETWORK,
        llm: LLM_MODEL,
        wallet: agentKeypair.publicKey(),
        usdc: usdcBalance,
        degraded: isDegradedMode,
        availableDrugs: getAvailableDrugs(),
      },
      "CareGuard Unified Server started",
    );
    await startWalletBalanceScheduler();
  });

  gracefulShutdown({
    server,
    onDrainStart: () => {
      isDraining = true;
    },
  });
}
