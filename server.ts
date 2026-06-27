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
import { createHash } from "crypto";
import express, { type Express } from "express";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import OpenAI from "openai";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { z } from "zod";

// x402 middleware
import { applyX402Middleware } from "./shared/x402-middleware.ts";
import { createCorsMiddleware } from "./shared/cors.ts";
import { applySecurityMiddleware } from "./shared/security-middleware.ts";
import { logger } from "./shared/logger.ts";
import { validateTask, getSuspiciousTaskCount } from "./shared/task-validation.ts";
import { buildScrubSession, scrubText } from "./shared/prompt-scrub.ts";
import {
  BillAuditValidationError,
  validateBillAuditRequest,
} from "./shared/bill-audit.ts";
import { sanitizeUserString } from "./shared/sanitize.ts";

// Sentry (gated by SENTRY_DSN)
import { initSentry } from "./shared/sentry.ts";

// Observability
import { requestContextMiddleware, setAgentRunId, getRequestId } from "./shared/request-context.ts";
import { requestLoggerMiddleware } from "./shared/request-logger.ts";
import {
  metricsHandler,
  agentRunsTotal,
  agentToolCallsTotal,
} from "./shared/metrics.ts";

// Shared agent pause state + wallet low-balance scheduler
import {
  getAgentState,
  pauseAgent,
  resumeAgent,
  isPaused,
  type PauseReason,
} from "./shared/agent-state.ts";
import { checkWalletBalance, formatResult } from "./shared/wallet-balance.ts";
import { appendAuditEntry, auditRouter } from "./shared/audit-log.ts";
import { rateLimiters } from "./shared/rate-limit.ts";
import { agentQueue } from "./shared/agent-queue.ts";

// Agent tools
import {
  comparePharmacyPrices,
  auditBill,
  fetchRosaBill,
  fetchAndAuditBill,
  checkDrugInteractions,
  payForMedication,
  payBill,
  checkSpendingPolicy,
  getSpendingSummary,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  TOOL_DEFINITIONS,
  validateToolInput,
} from "./agent/tools.ts";
import { resolveRequestedDosage } from "./services/pharmacy-api/dosage.ts";
import { createPharmacyPricingStore } from "./services/pharmacy-api/db.ts";
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
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3004),
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
  OZ_FACILITATOR_API_KEY: z.string().min(1).optional(),
  X402_FACILITATOR_URL: z.string().min(1).optional(),
  BILL_AUDIT_OVERCHARGE_MULTIPLIER: z.coerce.number().positive().default(1.5),
  BILL_AUDIT_SUGGESTED_MULTIPLIER: z.coerce.number().positive().default(1.2),
  BILL_AUDIT_UPCODED_MULTIPLIER: z.coerce.number().positive().default(3.0),
}).refine(
  (data) => {
    return (
      data.BILL_AUDIT_UPCODED_MULTIPLIER > data.BILL_AUDIT_OVERCHARGE_MULTIPLIER &&
      data.BILL_AUDIT_OVERCHARGE_MULTIPLIER > data.BILL_AUDIT_SUGGESTED_MULTIPLIER &&
      data.BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0
    );
  },
  {
    message: "Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1.0",
    path: ["BILL_AUDIT_UPCODED_MULTIPLIER"],
  }
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

if (env.data.STELLAR_NETWORK === "public" && !env.data.OZ_FACILITATOR_API_KEY) {
  process.stderr.write(
    "Missing/invalid env: OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public\n",
  );
  process.exit(1);
}

if (env.data.STELLAR_NETWORK !== "public" && !env.data.OZ_FACILITATOR_API_KEY) {
  logger.warn("OZ_FACILITATOR_API_KEY not set — x402 routes will fail until configured");
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
const MAX_TOOL_CALLS_PER_RUN = parseInt(process.env.MAX_TOOL_CALLS_PER_RUN || "30", 10);
let toolCallCapHitsTotal = 0;

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
  recipient: { ..._DEFAULT_PROFILE.recipient, medications: [..._DEFAULT_PROFILE.recipient.medications] },
  caregiver: { ..._DEFAULT_PROFILE.caregiver },
};

// --- Express App ---
const app: Express = express();
let isDraining = false;

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURIComponent(parts.join("="));
  });
  return list;
}

function requireCaregiverToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  let token: string | undefined;

  if (auth?.startsWith("Bearer ")) {
    token = auth.slice("Bearer ".length);
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies["caregiver_token"];
    
    if (token) {
      const csrfHeader = req.headers["x-csrf-token"];
      const csrfCookie = cookies["csrf_token"];
      if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
        res.status(403).json({ error: "CSRF token mismatch or missing" });
        return;
      }
    }
  }

  if (!token) {
    res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ error: "Missing caregiver token" });
    return;
  }
  if (token !== CAREGIVER_TOKEN) {
    res.status(403).json({ error: "Invalid caregiver token" });
    return;
  }
  next();
}

app.use("/agent", rateLimiters.agent);
app.use("/health", rateLimiters.health);
app.use(rateLimiters.default);
const sentry = await initSentry({ service: "careguard-server" });
app.use(sentry.requestHandler());
applySecurityMiddleware(app);
app.use(createCorsMiddleware());
const _smallJson = express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" });
const _largeJson = express.json({ limit: process.env.BILL_AUDIT_BODY_LIMIT ?? "256kb" });
app.use((req, res, next) =>
  (req.path.startsWith("/bill/audit") ? _largeJson : _smallJson)(req, res, next)
);
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());
app.use("/agent", requireCaregiverToken);
app.use("/agent/audit", auditRouter);

// --- Prometheus metrics ---
app.get("/metrics", metricsHandler());

// --- Root info ---
app.get("/", (_req, res) => {
  const state = getAgentState();
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: NETWORK,
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    careRecipient: "Rosa Garcia",
    caregiver: "Maria Garcia",
    paused: state.paused,
    pausedReason: state.pausedReason,
    pausedAt: state.pausedAt,
    mode: "unified",
  });
});

// --- Liveness probe — no I/O, always fast ---
app.get("/health", (_req, res) => {
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
  const requiredEnv = ["LLM_API_KEY", "AGENT_SECRET_KEY", "MPP_SECRET_KEY", "CAREGIVER_TOKEN"];
  const missingEnv = requiredEnv.filter((k) => !process.env[k]);
  checks.env = missingEnv.length === 0 ? true : `missing: ${missingEnv.join(", ")}`;

  // 2. Horizon ping
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const resp = await fetch("https://horizon-testnet.stellar.org", { signal: controller.signal });
    clearTimeout(timeout);
    checks.horizon = resp.ok || resp.status < 500;
  } catch {
    checks.horizon = false;
  }

  // 3. OZ facilitator reachability (set by middleware on successful payment verification)
  checks.ozFacilitator = ozFacilitatorReachable || !env.data.OZ_FACILITATOR_API_KEY
    ? true
    : "not yet verified";

  const allOk = Object.values(checks).every((v) => v === true);
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ok" : "degraded", checks });
});

// --- Profile (issue #79) ---
app.get("/agent/profile", (_req, res) => { res.json(_profileData); });

app.patch("/agent/profile", (req, res) => {
  const { recipient, caregiver } = req.body ?? {};
  if (recipient && typeof recipient === "object") {
    _profileData.recipient = { ..._profileData.recipient, ...recipient };
    if (Array.isArray(recipient.medications)) {
      _profileData.recipient.medications = recipient.medications;
    }
  }
  if (caregiver && typeof caregiver === "object") {
    _profileData.caregiver = { ..._profileData.caregiver, ...caregiver };
  }
  res.json(_profileData);
});

// ============================================================
// PHARMACY PRICE API (was port 3001)
// ============================================================

const PHARMACY_ADMIN_TOKEN = process.env.PHARMACY_ADMIN_TOKEN || CAREGIVER_TOKEN;
const pharmacyStore = createPharmacyPricingStore();

function requirePharmacyAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res
      .status(401)
      .setHeader("WWW-Authenticate", "Bearer")
      .json({ error: "Missing admin token" });
    return;
  }

  if (auth.slice("Bearer ".length) !== PHARMACY_ADMIN_TOKEN) {
    res.status(403).json({ error: "Invalid admin token" });
    return;
  }

  next();
}

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

  res.json({ drug: pharmacyStore.upsertDrug(parsedBody.data as DrugRecordInput) });
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
    pharmacy: pharmacyStore.upsertPharmacy(parsedBody.data as PharmacyRecordInput),
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

app.get("/pharmacy/compare", (req, res) => {
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
    const prices = pharmacyStore.getPrices(drug);
    res.json(
      buildCompareResponse({
        drug,
        dosage,
        zip: query.zip,
        payTo: env.data.PHARMACY_1_PUBLIC_KEY,
        network: NETWORK,
        prices,
      }),
    );
  } catch (error) {
    res.status(404).json({
      error: error instanceof Error ? error.message : `Drug "${drug}" not found`,
      provider: "sqlite",
      drugCount: pharmacyStore.getDrugCount(),
    });
  }
});

// ============================================================
// BILL AUDIT API (was port 3002)
// ============================================================

const FAIR_MARKET_RATES: Record<
  string,
  { description: string; fairRate: number }
> = {
  "99213": { description: "Office visit, moderate", fairRate: 130 },
  "99214": { description: "Office visit, high", fairRate: 195 },
  "99215": { description: "Office visit, complex", fairRate: 265 },
  "70553": { description: "MRI brain", fairRate: 450 },
  "71046": { description: "Chest X-ray", fairRate: 45 },
  "80053": { description: "Metabolic panel", fairRate: 25 },
  "85025": { description: "CBC", fairRate: 15 },
  "36415": { description: "Venipuncture", fairRate: 10 },
  "93000": { description: "ECG", fairRate: 35 },
  "99232": { description: "Hospital care, moderate", fairRate: 145 },
  "99233": { description: "Hospital care, high", fairRate: 210 },
  "99238": { description: "Discharge day", fairRate: 160 },
  "96372": { description: "Injection", fairRate: 25 },
  J0170: { description: "Epinephrine", fairRate: 15 },
  "97110": { description: "Physical therapy", fairRate: 55 },
};

function runBillAudit(lineItems: any[]) {
  const results: any[] = [];
  let totalCharged = 0,
    totalCorrect = 0,
    errorCount = 0;
  const seenCodes: Record<string, number> = {};
  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fair = FAIR_MARKET_RATES[item.cptCode];
    const fairAmt = fair !== undefined ? fair.fairRate * item.quantity : null;
    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (
      seenCodes[item.cptCode] > 1 &&
      !["96372", "97110"].includes(item.cptCode)
    ) {
      errorCount++;
      results.push({
        ...item,
        fairMarketRate: fairAmt,
        status: "duplicate",
        errorDescription: `Duplicate CPT ${item.cptCode}`,
        suggestedAmount: 0,
      });
      continue;
    }
    if (fairAmt !== null && item.chargedAmount > fairAmt * 1.5) {
      errorCount++;
      const suggested = +(fairAmt * 1.2).toFixed(2);
      totalCorrect += suggested;
      results.push({
        ...item,
        fairMarketRate: fairAmt,
        status: item.chargedAmount > fairAmt * 3 ? "upcoded" : "overcharged",
        errorDescription: `Charged $${item.chargedAmount} — fair rate $${fairAmt}. Overcharged $${(item.chargedAmount - fairAmt).toFixed(2)}`,
        suggestedAmount: suggested,
      });
      continue;
    }
    const suggested = fairAmt !== null
      ? Math.min(item.chargedAmount, +(fairAmt * 1.2).toFixed(2))
      : item.chargedAmount;
    totalCorrect += suggested;
    results.push({
      ...item,
      fairMarketRate: fairAmt,
      status: "valid",
      errorDescription: null,
      suggestedAmount: suggested,
    });
  }
  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);
  return {
    auditTimestamp: new Date().toISOString(),
    protocol: {
      name: "x402",
      network: NETWORK,
      price: "$0.01",
      payTo: process.env.BILL_PROVIDER_PUBLIC_KEY,
    },
    totalCharged: +totalCharged.toFixed(2),
    totalCorrect: +totalCorrect.toFixed(2),
    totalOvercharge,
    savingsPercent:
      totalCharged > 0
        ? +((totalOvercharge / totalCharged) * 100).toFixed(1)
        : 0,
    errorCount,
    lineItems: results,
    recommendation:
      errorCount === 0
        ? "No errors detected."
        : `Found ${errorCount} errors totaling $${totalOvercharge} in overcharges (${((totalOvercharge / totalCharged) * 100).toFixed(1)}% of total bill). Strongly recommend filing a formal dispute.`,
  };
}

app.get("/bill/sample", (_req, res) => {
  res.json({
    patientName: "Rosa Garcia",
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

app.post("/bill/audit", (req, res) => {
  try {
    const validatedBody = validateBillAuditRequest(req.body);
    const sanitizedLineItems = validatedBody.lineItems.map((lineItem) => ({
      ...lineItem,
      description: sanitizeUserString(lineItem.description),
    }));
    res.json(runBillAudit(sanitizedLineItems));
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
});

// ============================================================
// DRUG INTERACTION API (was port 3003)
// ============================================================

// x402 for drug interactions
applyX402Middleware(app, {
  "GET /drug/interactions": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo:
        process.env.PHARMACY_2_PUBLIC_KEY || process.env.PHARMACY_1_PUBLIC_KEY!,
      price: "$0.001",
    },
    description: "Drug interaction check — $0.001 USDC",
  },
});

app.get("/drug/interactions", (req, res) => {
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
});

// ============================================================
// MPP PHARMACY PAYMENT (was port 3005)
// ============================================================

const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL("./data", import.meta.url));
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadOrders(): any[] {
  if (!existsSync(ORDERS_FILE)) return [];
  return JSON.parse(readFileSync(ORDERS_FILE, "utf-8"));
}
function saveOrder(order: any) {
  const orders = loadOrders();
  orders.push(order);
  writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
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
      store: Store.memory(),
    }),
  ],
});

app.get("/pharmacy/orders", (_req, res) => {
  res.json({ orders: loadOrders() });
});

app.post("/pharmacy/order", async (req, res) => {
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
  saveOrder(order);
  const response = result.withReceipt(
    Response.json({
      success: true,
      order,
      message: `Payment settled. ${safeDrug} from ${safePharmacy} confirmed.`,
    }),
  );
  response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
  res.status(response.status).json(await response.json());
});

// ============================================================
// AI AGENT
// ============================================================

const SYSTEM_PROMPT = `You are CareGuard, an AI agent that manages healthcare spending for elderly care recipients on Stellar.

Your responsibilities:
1. Compare medication prices across pharmacies and order from cheapest. Check drug interactions first.
2. Audit medical bills for errors (duplicates, upcoding, overcharges).
3. Pay for medications and bills within spending policy limits.

IMPORTANT RULES:
- Check spending policy BEFORE any payment
- When auditing a bill, use fetch_and_audit_bill which fetches Rosa's bill and audits it in one step. Never invent bill data.
- When comparing medications, compare ALL at once, check interactions, then order from cheapest
- Report savings found and API costs

Current care recipient: Rosa Garcia (age 78)
Caregiver: Maria Garcia (daughter)`;

// PHI scrubbing — active unless LLM_PII_SCRUB=false (e.g. provider has a BAA)
const _piiScrub = process.env.LLM_PII_SCRUB !== "false";
const _scrubSession = _piiScrub
  ? buildScrubSession(["Rosa Garcia"], ["Maria Garcia"])
  : null;
const SCRUBBED_SYSTEM_PROMPT = _scrubSession
  ? scrubText(SYSTEM_PROMPT, _scrubSession)
  : SYSTEM_PROMPT;

const LLM_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  TOOL_DEFINITIONS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: { ...t.input_schema, additionalProperties: false },
    },
  }));

async function executeTool(name: string, input: any): Promise<any> {
  let result: any;
  try {
    input = validateToolInput(name, input);
    switch (name) {
      case "compare_pharmacy_prices":
        result = await comparePharmacyPrices(input.drug_name, input.zip_code);
        break;
      case "audit_medical_bill": {
        const items =
          typeof input.line_items_json === "string"
            ? JSON.parse(input.line_items_json)
            : input.line_items || input.line_items_json;
        result = await auditBill(items);
        break;
      }
      case "fetch_rosa_bill":
        result = await fetchRosaBill();
        break;
      case "fetch_and_audit_bill":
        result = await fetchAndAuditBill();
        break;
      case "check_drug_interactions":
        result = await checkDrugInteractions(input.medications);
        break;
      case "pay_for_medication":
        result = await payForMedication(
          input.pharmacy_id,
          input.pharmacy_name,
          input.drug_name,
          parseFloat(input.amount),
        );
        break;
      case "pay_bill":
        result = await payBill(
          input.provider_id,
          input.provider_name,
          input.description,
          parseFloat(input.amount),
        );
        break;
      case "check_spending_policy":
        result = checkSpendingPolicy(parseFloat(input.amount), input.category);
        break;
      case "get_spending_summary":
        result = getSpendingSummary();
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }
    agentToolCallsTotal.inc({ tool: name, status: "success" });
    return result;
  } catch (err: any) {
    agentToolCallsTotal.inc({ tool: name, status: "error" });
    throw err;
  }
}

async function runAgent(task: string) {
  const userTask = _scrubSession ? scrubText(task, _scrubSession) : task;
  const runId = `run-${getRequestId() ?? Date.now()}`;
  setAgentRunId(runId);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SCRUBBED_SYSTEM_PROMPT },
    { role: "user", content: userTask },
  ];
  const toolCalls: Array<{ tool: string; input: any; result: any }> = [];
  let finalResponse = "";
  let runToolCalls = 0;
  let truncated = false;

  for (let iteration = 0; iteration < 15; iteration++) {
    let response;
    try {
      response = await llm.chat.completions.create({
        model: LLM_MODEL,
        max_tokens: 4096,
        tools: LLM_TOOLS,
        messages,
      });
    } catch (err: any) {
      logger.error({ err: err.message, iteration }, "LLM API error");
      if (toolCalls.length > 0 && !finalResponse) {
        finalResponse = toolCalls
          .map((tc) => {
            if (tc.result?.error) return `${tc.tool}: ${tc.result.error}`;
            if (tc.tool === "compare_pharmacy_prices" && tc.result?.cheapest)
              return `${tc.result.drug}: $${tc.result.cheapest.price} at ${tc.result.cheapest.pharmacyName} (save $${tc.result.potentialSavings}/mo)`;
            if (
              tc.tool === "fetch_and_audit_bill" &&
              tc.result?.totalOvercharge
            )
              return `Bill audit: $${tc.result.totalOvercharge} overcharges (${tc.result.errorCount} errors)`;
            if (tc.tool === "check_drug_interactions" && tc.result?.summary)
              return tc.result.summary;
            if (tc.tool === "pay_for_medication" && tc.result?.success)
              return `Paid $${tc.result.transaction.amount} for ${tc.result.transaction.description}`;
            return `${tc.tool}: completed`;
          })
          .join("\n");
      } else if (!finalResponse) finalResponse = `LLM error: ${err.message}`;
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;
    messages.push(choice.message);
    if (choice.message.content) finalResponse = choice.message.content;
    if (!choice.message.tool_calls?.length) break;

    // Cap total tool calls at iteration boundary to keep messages array consistent
    if (runToolCalls + choice.message.tool_calls.length > MAX_TOOL_CALLS_PER_RUN) {
      toolCallCapHitsTotal++;
      truncated = true;
      appendAuditEntry({ event: "agent.tool_cap_exceeded", actor: "agent", details: { max: MAX_TOOL_CALLS_PER_RUN, ran: runToolCalls } });
      finalResponse = finalResponse || "Tool call limit reached; partial results returned.";
      break;
    }
    runToolCalls += choice.message.tool_calls.length;

    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      let args: any;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }
      logger.info({ tool: tc.function.name, args: JSON.stringify(args).slice(0, 100) }, "tool call");
      let result: any;
      try {
        result = await executeTool(tc.function.name, args);
        toolCalls.push({ tool: tc.function.name, input: args, result });
      } catch (err: any) {
        logger.error({ tool: tc.function.name, err: err.message }, "tool error");
        result = { error: err.message };
        toolCalls.push({ tool: tc.function.name, input: args, result });
      }

      appendAuditEntry({
        event: "tool_call",
        actor: "agent",
        details: {
          tool: tc.function.name,
          inputs: args,
          resultHash: createHash("sha256").update(JSON.stringify(result || {})).digest("hex")
        }
      });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
    if (choice.finish_reason === "stop") break;
  }

  return { response: finalResponse, toolCalls, spending: getSpendingSummary(), truncated };
}

// Agent endpoints
app.get("/agent/status", (_req, res) => {
  res.json(getAgentState());
});
app.post("/agent/pause", (req, res) => {
  const raw = req.body?.reason;
  const reason: PauseReason =
    raw === "low-balance-usdc" || raw === "low-balance-xlm" ? raw : "manual";
  const state = pauseAgent(reason);
  appendAuditEntry({ event: "agent.paused", actor: "api", details: { reason } });
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
  const limit = parseInt(req.query.limit as string) || 25;
  const offset = parseInt(req.query.offset as string) || 0;
  const tracker = getSpendingTracker();
  const totalTransactions = tracker.transactions.length;
  const paginatedTransactions = tracker.transactions
    .slice(-offset - limit, -offset || undefined)
    .reverse();

  res.json({
    ...tracker,
    transactions: paginatedTransactions,
    pagination: {
      total: totalTransactions,
      limit,
      offset,
      hasMore: offset + limit < totalTransactions,
      hasPrevious: offset > 0,
    },
  });
});
app.post("/agent/policy", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid policy" });
  }
  const fields = ["dailyLimit", "monthlyLimit", "medicationMonthlyBudget", "billMonthlyBudget", "approvalThreshold"] as const;
  const errors: string[] = [];
  for (const f of fields) {
    const v = body[f];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) errors.push(`${f} must be a positive finite number`);
  }
  if (errors.length > 0) return res.status(400).json({ error: "Invalid policy", details: errors });
  setSpendingPolicy(body);
  res.json({ success: true, policy: body });
});
app.post("/agent/reset", (_req, res) => {
  resetSpendingTracker();
  res.json({ success: true });
});

app.post("/agent/run", async (req, res) => {
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
  logger.info({ task, suspicious: validation.suspicious }, "agent task received");
  try {
    const result = await agentQueue.enqueue(() => runAgent(task));
    agentRunsTotal.inc({ status: "success" });
    logger.info({ toolCalls: result.toolCalls.length, truncated: result.truncated }, "agent task complete");
    res.json(result);
  } catch (err: any) {
    if (err.status === 429) {
      res.status(429).set("Retry-After", String(err.retryAfter)).json({ error: err.message });
      return;
    }
    agentRunsTotal.inc({ status: "error" });
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START
// ============================================================

const horizonServer = new Horizon.Server("https://horizon-testnet.stellar.org");

// 413 handler — must be before Sentry so Sentry also captures it
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large", limit: err.limit });
  }
  next(err);
});

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
    logger.warn("wallet scheduler enabled but node-cron not installed — falling back to setInterval(15m)");
    setInterval(() => {
      checkWalletBalance().then((r) => logger.info({ result: formatResult(r) }, "wallet check"));
    }, 15 * 60_000);
    return;
  }

  if (!cron.validate?.(cronExpr)) {
    logger.warn({ cronExpr }, "invalid WALLET_BALANCE_CHECK_CRON, falling back to */15 * * * *");
  }
  const expr = cron.validate?.(cronExpr) ? cronExpr : "*/15 * * * *";

  cron.schedule(expr, async () => {
    const r = await checkWalletBalance();
    logger.info({ result: formatResult(r) }, "wallet check");
  });

  checkWalletBalance().then((r) => logger.info({ result: formatResult(r) }, "wallet check startup"));
  logger.info({ expr }, "wallet balance scheduler armed");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = app.listen(PORT, async () => {
    let usdcBalance = "unknown";
    try {
      const acc = await horizonServer.loadAccount(agentKeypair.publicKey());
      const usdc = acc.balances.find((b: any) => b.asset_code === "USDC");
      usdcBalance = usdc?.balance || "0";
    } catch {
      usdcBalance = "unable to check";
    }
    logger.info({ port: PORT, network: NETWORK, llm: LLM_MODEL, wallet: agentKeypair.publicKey(), usdc: usdcBalance }, "CareGuard Unified Server started");
    await startWalletBalanceScheduler();
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
}
