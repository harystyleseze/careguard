/**
 * CareGuard AI Agent — Autonomous healthcare financial coordinator
 *
 * Uses any OpenAI-compatible LLM provider (Groq, OpenRouter, OpenAI) with tool-use.
 * Every payment is real — x402 on Stellar for API queries, MPP Charge for medication orders,
 * direct Stellar USDC transfers for bill payments.
 *
 * Requires: LLM_API_KEY, AGENT_SECRET_KEY, OZ_FACILITATOR_API_KEY
 */

import "dotenv/config";
import { existsSync, mkdirSync } from "fs";
import express, { type Express } from "express";
import OpenAI from "openai";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import { createCorsMiddleware } from "../shared/cors.ts";
import { applySecurityMiddleware } from "../shared/security-middleware.ts";
import { logger } from "../shared/logger.ts";
import { validateTask, getSuspiciousTaskCount } from "../shared/task-validation.ts";
import { appendAuditEntry, auditRouter } from "../shared/audit-log.ts";
import { rateLimiters } from "../shared/rate-limit.ts";
import { agentQueue } from "../shared/agent-queue.ts";
import { requestContextMiddleware } from "../shared/request-context.ts";
import { requestLoggerMiddleware } from "../shared/request-logger.ts";
import {
  metricsHandler,
  agentRunsTotal,
} from "../shared/metrics.ts";
import { redactPII, hashTask } from "../shared/redact.ts";
import {
  getSpendingSummary,
  getWalletBalance,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  saveSpending,
  generateDisputeLetter,
  getAdherenceStatus,
  confirmAdherenceReminder,
  setCurrentRecipient,
  SpendingPolicySchema,
  payForMedication,
  payBill,
} from "./tools.ts";
import { getPendingAdherences } from "../shared/adherence.ts";
import { notify } from "../shared/notifications.ts";
import { resolveStellarNetwork, validateSignerKeyForNetwork } from "../shared/stellar-network.ts";
import { verifyWebhook } from "../shared/verify-webhook.ts";
import { executeTool, runAgent, buildSystemPrompt } from "./runner.ts";
import { requireApiKey } from "../shared/auth.ts";

const PORT = parseInt(process.env.AGENT_PORT || "3004");

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required in .env");
if (!process.env.AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required in .env");
if (!process.env.CAREGIVER_TOKEN) throw new Error("CAREGIVER_TOKEN required in .env");

if (process.env.NODE_ENV === "production" && !process.env.AGENT_API_KEY) {
  throw new Error("AGENT_API_KEY required in production");
}

const CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN;

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

// LLM Temperature configuration
// For tool-driven, deterministic agent behavior:
// - Tool-call rounds: temperature 0 (no variance, focused on function calling)
// - Final summary: temperature 0.3 (slight variance for natural phrasing)
const LLM_TOOL_TEMPERATURE = parseFloat(process.env.LLM_TOOL_TEMPERATURE || "0");
const LLM_SUMMARY_TEMPERATURE = parseFloat(process.env.LLM_SUMMARY_TEMPERATURE || "0.3");

// Maximum agentic loop iterations before the run is capped. Configurable via
// MAX_AGENT_ITERATIONS (default 15). When the cap is hit, the run appends an
// iteration_limit_reached event so the caller knows the task may be incomplete.
// Supports both MAX_AGENT_ITERATIONS and legacy AGENT_MAX_ITERATIONS for backwards compat.
const MAX_ITERATIONS = Math.max(1, parseInt(process.env.MAX_AGENT_ITERATIONS || process.env.AGENT_MAX_ITERATIONS || "15", 10) || 15);

// LLM max_tokens heuristic (Issue #280)
// Context-aware token budgeting to reduce wasted budget on simple queries:
// - 512: Tool-call result processing (small context window, just processing previous results)
// - 1024: Simple answers ("Did Rosa take her med?" style queries)
// - 4096: Full summaries with complex reasoning (default, most conservative)
const LLM_MAX_TOKENS_TOOL_RESULT = parseInt(process.env.LLM_MAX_TOKENS_TOOL_RESULT || "512", 10);
const LLM_MAX_TOKENS_SIMPLE = parseInt(process.env.LLM_MAX_TOKENS_SIMPLE || "1024", 10);
const LLM_MAX_TOKENS_SUMMARY = parseInt(process.env.LLM_MAX_TOKENS_SUMMARY || "4096", 10);

// Token tracking for alerting when usage is high
interface TokenStats {
  totalTokens: number;
  runCount: number;
  averagePerRun: number;
}
let tokenStats: TokenStats = { totalTokens: 0, runCount: 0, averagePerRun: 0 };
const TOKEN_USAGE_THRESHOLD_RATIO = 0.5; // Alert if average > 50% of LLM_MAX_TOKENS_SUMMARY

const llm = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: LLM_BASE_URL,
});

const STELLAR_CONFIG = resolveStellarNetwork();
const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET_KEY);
validateSignerKeyForNetwork(process.env.AGENT_SECRET_KEY, STELLAR_CONFIG);
const horizonServer = new Horizon.Server(STELLAR_CONFIG.horizonUrl);

const _piiScrub = process.env.LLM_PII_SCRUB !== "false";

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

// SSE client registry — one entry per open /agent/stream connection
const sseClients = new Set<express.Response>();

function broadcastSSE(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// Express API
const app: Express = express();

app.use("/agent", requireApiKey);
app.use("/agent/audit", auditRouter);
app.use("/agent", rateLimiters.agent);
app.use("/health", rateLimiters.health);
app.use(rateLimiters.default);

applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "64kb" }));
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());
app.get("/metrics", metricsHandler());

// Per-run tool call cap
const MAX_TOOL_CALLS_PER_RUN = parseInt(process.env.MAX_TOOL_CALLS_PER_RUN || "30", 10);
let toolCallCapHitsTotal = 0;

let agentPaused = false;

// In-memory cache for wallet balances (5s TTL)
interface WalletCacheEntry {
  data: { usdc: string; xlm: string; address: string };
  expiresAt: number;
}
const walletCache = new Map<string, WalletCacheEntry>();
const WALLET_CACHE_TTL_MS = 5000;

app.get("/agent/wallet", async (req, res) => {
  const address = agentKeypair.publicKey();
  const now = Date.now();
  const cached = walletCache.get(address);
  if (cached && cached.expiresAt > now) {
    return res.json(cached.data);
  }
  try {
    const account = await horizonServer.loadAccount(address);
    const usdc = account.balances.find((b: any) => b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER);
    const xlm = account.balances.find((b: any) => b.asset_type === "native");
    const data = {
      usdc: usdc ? parseFloat((usdc as any).balance).toFixed(2) : "0.00",
      xlm: xlm ? parseFloat((xlm as any).balance).toFixed(2) : "0.00",
      address,
    };
    walletCache.set(address, { data, expiresAt: now + WALLET_CACHE_TTL_MS });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: `Failed to load wallet: ${err.message}` });
  }
});

// Pending approvals
app.get("/agent/pending-approvals", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  const tracker = getSpendingTracker();
  const pending = tracker.transactions.filter((t: any) => t.status === "pending");
  res.json({ approvals: pending, recipientId });
});

// Approve or reject a pending transaction
app.post("/agent/approvals/:txId", async (req, res) => {
  const { txId } = req.params;
  const { approve } = req.body;
  const recipientId = (req.query.recipient_id as string) || (req.body.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  const tracker = getSpendingTracker();
  const txIndex = tracker.transactions.findIndex((t: any) => t.id === txId);
  if (txIndex === -1) return res.status(404).json({ error: "Transaction not found" });
  const tx = tracker.transactions[txIndex];
  if (tx.status !== "pending") return res.status(400).json({ error: "Transaction is not pending" });

  if (!approve) {
    (tx as any).status = "rejected";
    saveSpending(tracker);
    return res.json({ success: true, status: "rejected" });
  }

  try {
    let result: any;
    if (tx.category === "medications") {
      const match = tx.description.match(/(.+) from (.+)/);
      if (!match) throw new Error("Cannot parse transaction description");
      const [, drugName, pharmacyName] = match;
      const pharmacyId = tx.recipient;
      result = await payForMedication(pharmacyId, pharmacyName, drugName, tx.amount, true);
    } else if (tx.category === "bills") {
      const match = tx.description.match(/(.+) — (.+)/);
      if (!match) throw new Error("Cannot parse transaction description");
      const [, description, providerName] = match;
      const providerId = tx.recipient;
      result = await payBill(providerId, providerName, description, tx.amount, true);
    } else {
      throw new Error("Unknown transaction category");
    }

    if (result.success) {
      tx.status = "completed";
      tx.stellarTxHash = result.transaction?.stellarTxHash;
      tracker.transactions[txIndex] = tx;
      saveSpending(tracker);
      return res.json({ success: true, status: "completed", transaction: result.transaction });
    } else {
      (tx as any).status = "rejected";
      saveSpending(tracker);
      return res.status(400).json({ success: false, error: result.error, status: "rejected" });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Approval failed: ${err.message}` });
  }
});

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: "stellar:testnet",
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    recipients: ["rosa"],
    caregiver: "Maria Garcia",
    paused: agentPaused,
  });
});

app.get("/agent/status", (_req, res) => { res.json({ paused: agentPaused }); });
app.post("/agent/pause", (_req, res) => {
  agentPaused = true;
  logger.info("agent paused by caregiver");
  notify({ level: "warning", title: "Agent Paused", description: "CareGuard agent has been paused by the caregiver. No payments or actions will be processed until resumed." });
  broadcastSSE("status", { paused: true });
  res.json({ paused: true });
});
app.post("/agent/resume", (_req, res) => {
  agentPaused = false;
  logger.info("agent resumed by caregiver");
  notify({ level: "info", title: "Agent Resumed", description: "CareGuard agent has been resumed and is now processing actions." });
  broadcastSSE("status", { paused: false });
  res.json({ paused: false });
});

// SSE stream: pushes spending, transactions, and agent status on state changes.
// Clients reconnect automatically via the EventSource API; heartbeats keep the
// connection alive through proxies that close idle connections.
app.get("/agent/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);

  res.write(`event: spending\ndata: ${JSON.stringify(getSpendingSummary())}\n\n`);
  res.write(`event: status\ndata: ${JSON.stringify({ paused: agentPaused })}\n\n`);
  res.write(`event: transactions\ndata: ${JSON.stringify(getSpendingTracker())}\n\n`);

  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      sseClients.delete(res);
      clearInterval(heartbeat);
    }
  }, 30_000);

  req.on("close", () => {
    sseClients.delete(res);
    clearInterval(heartbeat);
  });
});

app.post("/agent/run", async (req, res) => {
  const validation = validateTask(req.body?.task);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  if (agentPaused) { res.status(409).json({ error: "Agent is paused. Resume from the dashboard to continue.", paused: true }); return; }

  const task = validation.task!;
  logger.debug({ task: redactPII(task), suspicious: validation.suspicious }, "agent task received (redacted)");
  logger.info({ taskHash: hashTask(task) }, "agent task received");

  const activeRecipient = recipientProfiles.rosa ?? Object.values(recipientProfiles)[0];
  try {
    const result = await agentQueue.enqueue(() => runAgent({
      task,
      profile: {
        recipient: activeRecipient,
        caregiver: caregiverProfile,
      },
      llm,
      model: LLM_MODEL,
      maxIterations: MAX_ITERATIONS,
      maxToolCallsPerRun: MAX_TOOL_CALLS_PER_RUN,
      llmToolTemperature: LLM_TOOL_TEMPERATURE,
      llmSummaryTemperature: LLM_SUMMARY_TEMPERATURE,
      llmMaxTokensToolResult: LLM_MAX_TOKENS_TOOL_RESULT,
      llmMaxTokensSimple: LLM_MAX_TOKENS_SIMPLE,
      llmMaxTokensSummary: LLM_MAX_TOKENS_SUMMARY,
      llmContextWindow: parseInt(process.env.LLM_CONTEXT_WINDOW || "32768", 10),
      piiScrub: _piiScrub,
    }));
    agentRunsTotal.inc({ status: "success" });
    logger.info({ toolCalls: result.toolCalls.length, truncated: result.truncated, promptTokens: result.llmUsage.promptTokens, completionTokens: result.llmUsage.completionTokens }, "agent task complete");
    broadcastSSE("spending", getSpendingSummary());
    broadcastSSE("transactions", getSpendingTracker());
    res.json(result);
  } catch (err: any) {
    if (err.status === 429) {
      res.status(429).set("Retry-After", String(err.retryAfter)).json({ error: err.message });
      return;
    }
    agentRunsTotal.inc({ status: "error" });
    logger.error({ err: err.message }, "agent run error");
    res.status(500).json({ error: err.message });
  }
});

app.get("/agent/spending", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  res.json(getSpendingSummary());
});
app.get("/agent/transactions", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  res.json(getSpendingTracker());
});
app.post("/agent/policy", (req, res) => {
  const result = SpendingPolicySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "Invalid policy", issues: result.error.issues });
  }
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  setSpendingPolicy(result.data);
  appendAuditEntry({
    event: "agent.policy_updated",
    actor: "api",
    details: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      policy: result.data,
      recipientId,
    },
  });
  broadcastSSE("spending", getSpendingSummary());
  res.json({ success: true, policy: result.data, recipientId });
});
app.post("/agent/reset", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  resetSpendingTracker();
  appendAuditEntry({
    event: "agent.reset",
    actor: "api",
    details: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      recipientId,
    },
  });
  broadcastSSE("spending", getSpendingSummary());
  broadcastSSE("transactions", getSpendingTracker());
  res.json({ success: true, recipientId });
});

interface RecipientProfile {
  name: string;
  age: number;
  medications: string[];
  doctor: string;
  insurance: string;
}

const DEFAULT_RECIPIENTS: Record<string, RecipientProfile> = {
  rosa: {
    name: "Rosa Garcia",
    age: 78,
    medications: ["Lisinopril", "Metformin", "Atorvastatin", "Amlodipine"],
    doctor: "Dr. Chen, General Hospital",
    insurance: "Medicare Part D",
  },
};

const caregiverProfile = {
  name: "Maria Garcia",
  relationship: "Daughter",
  location: "Phoenix, AZ (800 miles from Rosa)",
  notifications: "Email + SMS",
  email: "maria@example.com",
  phone: "+15551234567",
};

let recipientProfiles: Record<string, RecipientProfile> = {};
for (const [id, profile] of Object.entries(DEFAULT_RECIPIENTS)) {
  recipientProfiles[id] = { ...profile, medications: [...profile.medications] };
}

app.get("/agent/recipients", (_req, res) => {
  res.json({ recipients: Object.keys(recipientProfiles), profiles: recipientProfiles });
});

app.put("/agent/recipients/:recipientId", (req, res) => {
  const { recipientId } = req.params;
  const { name, age, medications, doctor, insurance } = req.body ?? {};
  if (!recipientProfiles[recipientId]) {
    recipientProfiles[recipientId] = { ...DEFAULT_RECIPIENTS.rosa, name: recipientId, medications: [] };
  }
  if (name) recipientProfiles[recipientId].name = name;
  if (typeof age === "number") recipientProfiles[recipientId].age = age;
  if (Array.isArray(medications)) recipientProfiles[recipientId].medications = medications;
  if (doctor) recipientProfiles[recipientId].doctor = doctor;
  if (insurance) recipientProfiles[recipientId].insurance = insurance;
  const dir = new URL(`../data/recipients/${recipientId}`, import.meta.url).pathname;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  res.json({ success: true, recipient: recipientProfiles[recipientId] });
});

app.get("/agent/profile", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  const recipient = recipientProfiles[recipientId] || recipientProfiles.rosa;
  res.json({ recipient, caregiver: caregiverProfile });
});

app.patch("/agent/profile", (req, res) => {
  const { recipient, caregiver } = req.body ?? {};
  const recipientId = (req.query.recipient_id as string) || "rosa";
  if (recipient && typeof recipient === "object") {
    if (!recipientProfiles[recipientId]) {
      recipientProfiles[recipientId] = { ...DEFAULT_RECIPIENTS.rosa, name: recipientId, medications: [] };
    }
    recipientProfiles[recipientId] = { ...recipientProfiles[recipientId], ...recipient };
    if (Array.isArray(recipient.medications)) {
      recipientProfiles[recipientId].medications = recipient.medications;
    }
  }
  if (caregiver && typeof caregiver === "object") {
    Object.assign(caregiverProfile, caregiver);
  }
  res.json({ recipient: recipientProfiles[recipientId], caregiver: caregiverProfile });
});

// --- Adherence endpoints (#264) ---
app.get("/agent/adherence", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  res.json(getAdherenceStatus(recipientId));
});

app.get("/agent/adherence/pending", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  const pending = getPendingAdherences(recipientId);
  res.json({ pending, count: pending.length, recipientId });
});

app.post("/agent/adherence/confirm", (req, res) => {
  const { record_id } = req.body ?? {};
  if (!record_id) return res.status(400).json({ error: "record_id is required" });
  const success = confirmAdherenceReminder(record_id);
  res.json({ success: success.success });
});

// --- Dispute letter endpoint (#266) ---
app.post("/agent/dispute-letter", (req, res) => {
  const { bill_id, error_descriptions, audit_result_json, recipient_name, facility, caregiver_name, caregiver_email } = req.body ?? {};
  if (!bill_id || !audit_result_json || !recipient_name || !facility || !caregiver_name || !caregiver_email) {
    return res.status(400).json({ error: "Missing required fields: bill_id, audit_result_json, recipient_name, facility, caregiver_name, caregiver_email" });
  }
  let auditResult;
  try {
    auditResult = JSON.parse(audit_result_json);
  } catch {
    return res.status(400).json({ error: "audit_result_json must be valid JSON" });
  }
  const letter = generateDisputeLetter(bill_id, error_descriptions || [], auditResult, {
    name: recipient_name,
    facility,
    caregiverName: caregiver_name,
    caregiverEmail: caregiver_email,
  });
  res.json(letter);
});

// Startup: verify agent wallet has USDC balance
async function verifyWallet() {
  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcBalance = account.balances.find((b: any) => b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER);
    if (!usdcBalance) {
      logger.error({ wallet: agentKeypair.publicKey() }, "agent wallet has no USDC trustline — fund at https://faucet.circle.com");
      process.exit(1);
    }
    logger.info({ usdc: usdcBalance.balance, xlm: account.balances.find((b: any) => b.asset_type === "native")?.balance || "0" }, "wallet balances");
  } catch (err: any) {
    logger.error({ err: err.message, wallet: agentKeypair.publicKey() }, "failed to load agent wallet");
    process.exit(1);
  }
}

// ── Stellar deposit webhook (stub) ────────────────────────────────────────────
// Mounted with express.raw() so the middleware receives the unmodified body
// bytes for HMAC verification.  Business logic (reconciliation, top-up) will
// be added here once the Stellar Horizon webhook integration is live.
app.post(
  "/webhooks/stellar/deposit",
  express.raw({ type: "application/json" }),
  verifyWebhook(),
  (req: express.Request, res: express.Response) => {
    const payload = JSON.parse(
      Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body),
    ) as Record<string, unknown>;
    logger.info({ payload }, "stellar deposit webhook received");
    res.status(200).json({ status: "received" });
  },
);

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

export { app };

const server = app.listen(PORT, async () => {
  logger.info(
    {
      port: PORT,
      network: STELLAR_CONFIG.networkType,
      horizonUrl: STELLAR_CONFIG.horizonUrl,
      llm: LLM_MODEL,
      llmBaseUrl: LLM_BASE_URL,
      llmToolTemperature: LLM_TOOL_TEMPERATURE,
      llmSummaryTemperature: LLM_SUMMARY_TEMPERATURE,
      wallet: agentKeypair.publicKey(),
    },
    "CareGuard Agent started"
  );
  await verifyWallet();
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
