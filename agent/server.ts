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
import { createHash } from "crypto";
import { resolve } from "path";
import { fileURLToPath } from "url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  promises as fsPromises,
} from "fs";
import express, { type Express } from "express";
import OpenAI from "openai";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import { createCorsMiddleware } from "../shared/cors.ts";
import { applySecurityMiddleware } from "../shared/security-middleware.ts";
import { logger } from "../shared/logger.ts";
import {
  validateTask,
  getSuspiciousTaskCount,
} from "../shared/task-validation.ts";
import { appendAuditEntry, auditRouter } from "../shared/audit-log.ts";
import { pushTokenRouter } from "../shared/push-tokens.ts";
import {
  orderStatusRouter,
  pharmacyWebhookRouter,
} from "../shared/order-status.ts";
import { startOrderStatusReminderCron } from "../shared/order-status-reminder.ts";
import { rateLimiters } from "../shared/rate-limit.ts";
import { agentQueue } from "../shared/agent-queue.ts";
import { requestLifecycleMiddleware } from "../shared/request-lifecycle.ts";
import { metricsHandler, agentRunsTotal } from "../shared/metrics.ts";
import { redactPII, hashTask, registerKnownNames } from "../shared/redact.ts";
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
  previewSpendingPolicy,
  getDataDir,
  approvePendingTransaction,
} from "./tools.ts";
import { getAdherenceTimeline, getPendingAdherences, skipAdherence } from "../shared/adherence.ts";
import { createVitalsStore } from "../services/vitals/db.ts";
import { createVitalsRouter } from "../services/vitals/routes.ts";
import { getInteractionCheckStore } from "../services/interaction-checks/db.ts";
import { createInteractionChecksRouter } from "../services/interaction-checks/routes.ts";
import { createCareRecipientsStore } from "../services/care-recipients/db.ts";
import { authorizeApprovalActor, createDelegationsRouter } from "../services/care-recipients/delegation.ts";
import { createInsuranceNetworkRouter } from "../services/care-recipients/insurance-network.ts";
import {
  createProfileChangesRouter,
  submitPolicyUpdate,
  type PolicyAccess,
} from "../services/care-recipients/profile-changes.ts";
import { listActionReasoning } from "../shared/agent-state.ts";
import { notify } from "../shared/notifications.ts";
import {
  resolveStellarNetwork,
  validateSignerKeyForNetwork,
} from "../shared/stellar-network.ts";
import { verifyWebhook } from "../shared/verify-webhook.ts";
import { requireApiKey } from "../shared/auth.ts";
import { fetchWalletBalances } from "../shared/wallet-balance.ts";
import {
  loadRecipientAllergies,
  addRecipientAllergy,
  removeRecipientAllergy,
} from "../shared/allergies.ts";
import { loadPresenceMap, recordItemView } from "../shared/presence.ts";
import { extractLineItemsFromBillImage } from "../shared/bill-ocr.ts";
import { runPriceWatchForRecipient } from "./price-watch.ts";
import {
  loadMultisigConfig,
  saveMultisigConfig,
  loadMultisigRequests,
  signAndSubmitMultisigRequest,
  rejectMultisigRequest,
} from "../shared/multisig.ts";
import {
  recordDosageChange,
  getMedicationHistory,
} from "../shared/medication-history.ts";

const PORT = parseInt(process.env.AGENT_PORT || "3004", 10);

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required in .env");
if (!process.env.AGENT_SECRET_KEY)
  throw new Error("AGENT_SECRET_KEY required in .env");
if (!process.env.CAREGIVER_TOKEN)
  throw new Error("CAREGIVER_TOKEN required in .env");

if (process.env.NODE_ENV === "production" && !process.env.AGENT_API_KEY) {
  throw new Error("AGENT_API_KEY required in production");
}

const CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN;

const LLM_BASE_URL =
  process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

// LLM Temperature configuration
// For tool-driven, deterministic agent behavior:
// - Tool-call rounds: temperature 0 (no variance, focused on function calling)
// - Final summary: temperature 0.3 (slight variance for natural phrasing)
const LLM_TOOL_TEMPERATURE = parseFloat(
  process.env.LLM_TOOL_TEMPERATURE || "0",
);
const LLM_SUMMARY_TEMPERATURE = parseFloat(
  process.env.LLM_SUMMARY_TEMPERATURE || "0.3",
);

// Maximum agentic loop iterations before the run is capped. Configurable via
// MAX_AGENT_ITERATIONS (default 15). When the cap is hit, the run appends an
// iteration_limit_reached event so the caller knows the task may be incomplete.
// Supports both MAX_AGENT_ITERATIONS and legacy AGENT_MAX_ITERATIONS for backwards compat.
const MAX_ITERATIONS = Math.max(
  1,
  parseInt(
    process.env.MAX_AGENT_ITERATIONS ||
      process.env.AGENT_MAX_ITERATIONS ||
      "15",
    10,
  ) || 15,
);

// LLM max_tokens heuristic (Issue #280)
// Context-aware token budgeting to reduce wasted budget on simple queries:
// - 512: Tool-call result processing (small context window, just processing previous results)
// - 1024: Simple answers ("Did Rosa take her med?" style queries)
// - 4096: Full summaries with complex reasoning (default, most conservative)
const LLM_MAX_TOKENS_TOOL_RESULT = parseInt(
  process.env.LLM_MAX_TOKENS_TOOL_RESULT || "512",
  10,
);
const LLM_MAX_TOKENS_SIMPLE = parseInt(
  process.env.LLM_MAX_TOKENS_SIMPLE || "1024",
  10,
);
const LLM_MAX_TOKENS_SUMMARY = parseInt(
  process.env.LLM_MAX_TOKENS_SUMMARY || "4096",
  10,
);

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

function parseCookies(
  cookieHeader: string | undefined,
): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    list[parts.shift()!.trim()] = decodeURIComponent(parts.join("="));
  });
  return list;
}

function requireCaregiverToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
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
    res
      .status(401)
      .setHeader("WWW-Authenticate", "Bearer")
      .json({ error: "Missing caregiver token" });
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
app.use("/agent/push-tokens", pushTokenRouter);
app.use("/agent/transactions/:txId/order-status", orderStatusRouter);
app.use("/agent/order-status-webhook", pharmacyWebhookRouter);
app.use("/agent", rateLimiters.agent);
app.use("/health", rateLimiters.health);
app.use(rateLimiters.default);

applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT ?? "20kb",
    type: (req) =>
      req.path !== "/webhooks/stellar/deposit" &&
      Boolean(req.is("application/json")),
  }),
);
app.use(requestLifecycleMiddleware());
app.get("/metrics", metricsHandler());

// Per-run tool call cap
const MAX_TOOL_CALLS_PER_RUN = parseInt(process.env.MAX_TOOL_CALLS_PER_RUN || "30", 10);

// ── Persisted agent-pause state (Issue #17) ──────────────────────────────────
// Persists to data/agent-state.json so a paused agent stays paused across
// restarts.  Writes are atomic (tmp + rename) to avoid corrupt reads.
const AGENT_STATE_FILE = () => process.env.AGENT_STATE_FILE || `${getDataDir()}/agent-state.json`;

export async function loadAgentState(): Promise<{ paused: boolean }> {
  try {
    const file = AGENT_STATE_FILE();
    const data = await fsPromises.readFile(file, "utf-8");
    return JSON.parse(data);
  } catch {
    return { paused: false };
  }
}

export function loadAgentStateSync(): { paused: boolean } {
  try {
    const file = AGENT_STATE_FILE();
    if (!existsSync(file)) return { paused: false };
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return { paused: false };
  }
}

export async function saveAgentState(state: { paused: boolean }): Promise<void> {
  try {
    const file = AGENT_STATE_FILE();
    const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await fsPromises.writeFile(tmp, JSON.stringify(state), "utf-8");
    await fsPromises.rename(tmp, file);
  } catch (err) {
    logger.warn({ err }, "[agent-state] Failed to persist agent state");
  }
}

let agentPaused = (await loadAgentState()).paused;

app.get("/agent/wallet", async (req, res) => {
  const address = agentKeypair.publicKey();
  try {
    const account = await horizonServer.loadAccount(address);
    const usdc = account.balances.find(
      (b: any) =>
        b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER,
    );
    const xlm = account.balances.find((b: any) => b.asset_type === "native");
    const data = {
      usdc: balances.usdc.toFixed(2),
      xlm: balances.xlm.toFixed(2),
      address,
    };
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
  const pending = tracker.transactions.filter(
    (t: any) => t.status === "pending",
  );
  res.json({ approvals: pending, recipientId });
});

// Temporary approval delegation (#1195). Same SQLite file as the unified server's store.
const delegationStore = createCareRecipientsStore();
app.use("/agent", createDelegationsRouter(delegationStore));

// #1233: how an approved policy-limit increase is applied.
const policyAccess: PolicyAccess = {
  get(recipientId) {
    setCurrentRecipient(recipientId);
    return getSpendingSummary().policy;
  },
  set(recipientId, policy) {
    const parsed = SpendingPolicySchema.safeParse(policy);
    if (!parsed.success) return parsed.error.issues.map((issue) => issue.message).join("; ");
    setCurrentRecipient(recipientId);
    setSpendingPolicy(parsed.data);
    broadcastSSE("spending", getSpendingSummary());
    return null;
  },
};
// #1234: caregiver-maintained in-network pharmacy/provider lists.
app.use("/agent", createInsuranceNetworkRouter(delegationStore));
// #1233: owner approval for sensitive profile changes (and auto-topup rules).
app.use("/agent", createProfileChangesRouter(delegationStore, { policy: policyAccess }));
// #1235: plain-language "why did this happen?" traces for recent agent actions.
app.get("/agent/reasoning", (req, res) => {
  const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  res.json({
    reasoning: listActionReasoning({
      limit: Number.isFinite(limit) ? limit : 50,
      transactionId: typeof req.query.transaction_id === "string" ? req.query.transaction_id : undefined,
      toolCallId: typeof req.query.tool_call_id === "string" ? req.query.tool_call_id : undefined,
    }),
  });
});

// Approve or reject a pending transaction.
// Optional body: caregiver_id (who is acting) and on_behalf_of (whose authority
// they're using). Acting on_behalf_of someone requires an active delegation.
app.post("/agent/approvals/:txId", async (req, res) => {
  const { txId } = req.params;
  const { approve } = req.body;
  const recipientId =
    (req.query.recipient_id as string) ||
    (req.body.recipient_id as string) ||
    "rosa";
  setCurrentRecipient(recipientId);

  // Validate the transaction exists and is still pending before acting.
  const tracker = getSpendingTracker();
  const tx = tracker.transactions.find((t: any) => t.id === txId);
  if (!tx) return res.status(404).json({ error: "Transaction not found" });
  if (tx.status !== "pending")
    return res.status(400).json({ error: "Transaction is not pending" });

  if (!approve) {
    (tx as any).status = "rejected";
    tracker.transactions = tracker.transactions.map((t: any) =>
      t.id === txId ? tx : t,
    );
    saveSpending(tracker);
    return res.json({ success: true, status: "rejected" });
  }

  try {
    // Delegate to the unified approvePendingTransaction path so the HTTP route
    // and the background scanner share audit logging, budget bookkeeping, and
    // status transitions (#1029).
    const result = await approvePendingTransaction(txId);
    if (result.success) {
      return res.json({
        success: true,
        status: "completed",
        transaction: result.transaction,
      });
    } else {
      return res
        .status(400)
        .json({ success: false, error: result.error, status: "rejected" });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Approval failed: ${err.message}` });
  }
});

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: `stellar:${STELLAR_CONFIG.networkType}`,
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    recipients: Object.keys(recipientProfiles),
    caregiver: caregiverProfile.name,
    paused: agentPaused,
  });
});

app.get("/agent/status", (_req, res) => {
  res.json({ paused: agentPaused });
});
app.post("/agent/pause", async (_req, res) => {
  agentPaused = true;
  await saveAgentState({ paused: true });
  logger.info("agent paused by caregiver");
  notify({
    level: "warning",
    title: "Agent Paused",
    description:
      "CareGuard agent has been paused by the caregiver. No payments or actions will be processed until resumed.",
  });
  broadcastSSE("status", { paused: true });
  res.json({ paused: true });
});
app.post("/agent/resume", async (_req, res) => {
  agentPaused = false;
  await saveAgentState({ paused: false });
  logger.info("agent resumed by caregiver");
  notify({
    level: "info",
    title: "Agent Resumed",
    description:
      "CareGuard agent has been resumed and is now processing actions.",
  });
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

  res.write(
    `event: spending\ndata: ${JSON.stringify(getSpendingSummary())}\n\n`,
  );
  res.write(
    `event: status\ndata: ${JSON.stringify({ paused: agentPaused })}\n\n`,
  );
  res.write(
    `event: transactions\ndata: ${JSON.stringify(getSpendingTracker())}\n\n`,
  );

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
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  if (agentPaused) {
    res.status(409).json({
      error: "Agent is paused. Resume from the dashboard to continue.",
      paused: true,
    });
    return;
  }

  const task = validation.task!;
  logger.debug(
    { task: redactPII(task), suspicious: validation.suspicious },
    "agent task received (redacted)",
  );
  logger.info({ taskHash: hashTask(task) }, "agent task received");

  const activeRecipient =
    recipientProfiles.rosa ?? Object.values(recipientProfiles)[0];
  try {
    const result = await agentQueue.enqueue(() =>
      runAgent({
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
        llmContextWindow: parseInt(
          process.env.LLM_CONTEXT_WINDOW || "32768",
          10,
        ),
        piiScrub: _piiScrub,
      }),
    );
    agentRunsTotal.inc({ status: "success" });
    logger.info(
      {
        toolCalls: result.toolCalls.length,
        truncated: result.truncated,
        promptTokens: result.llmUsage.promptTokens,
        completionTokens: result.llmUsage.completionTokens,
      },
      "agent task complete",
    );
    broadcastSSE("spending", getSpendingSummary());
    broadcastSSE("transactions", getSpendingTracker());
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
app.post("/agent/policy", async (req, res) => {
  const result = SpendingPolicySchema.safeParse(req.body);
  if (!result.success) {
    return res
      .status(400)
      .json({ error: "Invalid policy", issues: result.error.issues });
  }
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  // #1233: limit increases wait for owner approval; the rest applies now.
  const outcome = submitPolicyUpdate(delegationStore, policyAccess, {
    recipientId,
    proposed: result.data,
    requestedBy: typeof req.body?.caregiver_id === "string" ? req.body.caregiver_id : "api",
  });
  if (!outcome.ok) {
    return res.status(400).json({ error: "Invalid policy", message: outcome.error });
  }
  await appendAuditEntry({
    event: "agent.policy_updated",
    actor: "api",
    details: {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      policy: outcome.applied,
      recipientId,
      ...(outcome.pendingApproval ? { pendingApprovalId: outcome.pendingApproval.id } : {}),
    },
  });
  broadcastSSE("spending", getSpendingSummary());
  res.status(outcome.pendingApproval ? 202 : 200).json({
    success: true,
    policy: outcome.applied,
    recipientId,
    pendingApproval: outcome.pendingApproval,
  });
});
// #1238: replay recent payments through check_spending_policy's rules under
// the proposed policy so the dashboard can preview a change before saving it.
app.post("/agent/policy/preview", (req, res) => {
  const result = SpendingPolicySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "Invalid policy", issues: result.error.issues });
  }
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  res.json({ recipientId, impact: previewSpendingPolicy(result.data) });
});
app.post("/agent/reset", async (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  resetSpendingTracker();
  await appendAuditEntry({
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
registerKnownNames([caregiverProfile.name]);
registerKnownNames(Object.values(recipientProfiles).map((p) => p.name));

app.get("/agent/recipients", (_req, res) => {
  res.json({
    recipients: Object.keys(recipientProfiles),
    profiles: recipientProfiles,
  });
});

app.put("/agent/recipients/:recipientId", (req, res) => {
  const { recipientId } = req.params;
  const { name, age, medications, doctor, insurance } = req.body ?? {};
  if (!recipientProfiles[recipientId]) {
    recipientProfiles[recipientId] = {
      ...DEFAULT_RECIPIENTS.rosa,
      name: recipientId,
      medications: [],
    };
  }
  if (name) {
    recipientProfiles[recipientId].name = name;
    registerKnownNames([name]);
  }
  if (typeof age === "number") recipientProfiles[recipientId].age = age;
  if (Array.isArray(medications))
    recipientProfiles[recipientId].medications = medications;
  if (doctor) recipientProfiles[recipientId].doctor = doctor;
  if (insurance) recipientProfiles[recipientId].insurance = insurance;
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
      recipientProfiles[recipientId] = {
        ...DEFAULT_RECIPIENTS.rosa,
        name: recipientId,
        medications: [],
      };
    }
    recipientProfiles[recipientId] = {
      ...recipientProfiles[recipientId],
      ...recipient,
    };
    if (Array.isArray(recipient.medications)) {
      recipientProfiles[recipientId].medications = recipient.medications;
    }
  }
  if (caregiver && typeof caregiver === "object") {
    Object.assign(caregiverProfile, caregiver);
    if (caregiver.name) {
      registerKnownNames([caregiver.name]);
    }
  }
  res.json({
    recipient: recipientProfiles[recipientId],
    caregiver: caregiverProfile,
  });
});

// --- Adherence endpoints (#264) ---
app.get("/agent/adherence", async (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  res.json(await getAdherenceStatus(recipientId));
});

app.get("/agent/adherence/pending", async (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  const pending = await getPendingAdherences(recipientId);
  res.json({ pending, count: pending.length, recipientId });
});

// #1237: dated adherence events, charted alongside logged vitals.
app.get("/agent/adherence/timeline", async (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  res.json({ recipientId, events: await getAdherenceTimeline(recipientId) });
});

app.post("/agent/adherence/confirm", async (req, res) => {
  const { record_id } = req.body ?? {};
  if (!record_id)
    return res.status(400).json({ error: "record_id is required" });
  const success = await confirmAdherenceReminder(record_id);
  res.json({ success: success.success });
});

// #1254: the OverviewTab adherence check's "Not Yet" — marks the most recent
// pending dose as skipped so persistent skips can escalate to flagged.
app.post("/agent/adherence/skip", async (req, res) => {
  const { record_id } = req.body ?? {};
  if (!record_id) return res.status(400).json({ error: "record_id is required" });
  const success = await skipAdherence(record_id);
  res.json({ success });
});

// --- Vitals endpoints (#1237) ---
app.use("/agent", createVitalsRouter(createVitalsStore()));
// #1193: searchable history of past drug interaction checks.
app.use("/agent", createInteractionChecksRouter(getInteractionCheckStore()));
// Searchable transcript of agent tool invocations and their outcomes.
app.use("/agent", createAgentHistoryRouter(getAgentHistoryStore()));

// --- Dispute letter endpoint (#266) ---
app.post("/agent/dispute-letter", (req, res) => {
  const {
    bill_id,
    error_descriptions,
    audit_result_json,
    recipient_name,
    facility,
    caregiver_name,
    caregiver_email,
  } = req.body ?? {};
  if (
    !bill_id ||
    !audit_result_json ||
    !recipient_name ||
    !facility ||
    !caregiver_name ||
    !caregiver_email
  ) {
    return res.status(400).json({
      error:
        "Missing required fields: bill_id, audit_result_json, recipient_name, facility, caregiver_name, caregiver_email",
    });
  }
  let auditResult;
  try {
    auditResult = JSON.parse(audit_result_json);
  } catch {
    return res
      .status(400)
      .json({ error: "audit_result_json must be valid JSON" });
  }
  const letter = generateDisputeLetter(
    bill_id,
    error_descriptions || [],
    auditResult,
    {
      name: recipient_name,
      facility,
      caregiverName: caregiver_name,
      caregiverEmail: caregiver_email,
    },
  );
  res.json(letter);
});

// --- Allergies endpoints (#1230) ---
app.get("/agent/allergies", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.query.recipientId as string) || "rosa";
  res.json({ allergies: loadRecipientAllergies(recipientId), recipientId });
});

app.post("/agent/allergies", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.body.recipientId as string) || "rosa";
  const { substance, severity, reaction, notes } = req.body ?? {};
  if (!substance || !severity) {
    return res.status(400).json({ error: "substance and severity are required" });
  }
  const created = addRecipientAllergy({ substance, severity, reaction, notes }, recipientId);
  res.status(201).json(created);
});

app.delete("/agent/allergies/:id", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  const success = removeRecipientAllergy(req.params.id, recipientId);
  res.json({ success });
});

// --- Co-Caregiver Presence endpoints (#1231) ---
app.get("/agent/presence", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.query.recipientId as string) || "rosa";
  res.json({ presence: loadPresenceMap(recipientId), recipientId });
});

app.post("/agent/presence/view", (req, res) => {
  const { itemId, itemType, caregiverId, caregiverName, avatar, recipientId } = req.body ?? {};
  if (!itemId || !itemType || !caregiverId || !caregiverName) {
    return res.status(400).json({ error: "itemId, itemType, caregiverId, and caregiverName are required" });
  }
  const entry = recordItemView({
    itemId,
    itemType,
    caregiverId,
    caregiverName,
    avatar,
    recipientId,
  });
  res.json({ success: true, entry });
});

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

// --- Price watch endpoint (#1236) ---
app.post("/agent/price-watch/run", async (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  try {
    const result = await runPriceWatchForRecipient(recipientId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Price watch failed" });
  }
});

// --- Multisig endpoints (#1226) ---
app.get("/agent/multisig/config", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.query.recipientId as string) || "rosa";
  res.json(loadMultisigConfig(recipientId));
});

app.post("/agent/multisig/config", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.body.recipientId as string) || "rosa";
  const { enabled, thresholdAmount, coSigners, timeWindowHours } = req.body ?? {};
  const current = loadMultisigConfig(recipientId);
  const updated = {
    recipientId,
    enabled: typeof enabled === "boolean" ? enabled : current.enabled,
    thresholdAmount: typeof thresholdAmount === "number" ? thresholdAmount : current.thresholdAmount,
    coSigners: Array.isArray(coSigners) ? coSigners : current.coSigners,
    timeWindowHours: typeof timeWindowHours === "number" ? timeWindowHours : current.timeWindowHours,
  };
  saveMultisigConfig(updated, recipientId);
  res.json({ success: true, config: updated });
});

app.get("/agent/multisig/pending", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.query.recipientId as string) || "rosa";
  const requests = loadMultisigRequests(recipientId);
  res.json({ requests, count: requests.length, recipientId });
});

app.post("/agent/multisig/sign", async (req, res) => {
  const { requestId, signerSecretOrSignedXdr, recipientId = "rosa" } = req.body ?? {};
  if (!requestId || !signerSecretOrSignedXdr) {
    return res.status(400).json({ error: "requestId and signerSecretOrSignedXdr are required" });
  }
  try {
    const result = await signAndSubmitMultisigRequest(requestId, signerSecretOrSignedXdr, recipientId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to sign multisig request" });
  }
});

app.post("/agent/multisig/reject", (req, res) => {
  const { requestId, reason, recipientId = "rosa" } = req.body ?? {};
  if (!requestId) {
    return res.status(400).json({ error: "requestId is required" });
  }
  try {
    const result = rejectMultisigRequest(requestId, reason, recipientId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to reject multisig request" });
  }
});

// --- Medication Dosage History endpoints (#1227) ---
app.get("/agent/medications/history", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || (req.query.recipientId as string) || "rosa";
  const medicationName = (req.query.medication_name as string) || (req.query.medicationName as string) || undefined;
  const history = getMedicationHistory(recipientId, medicationName);
  res.json({ history, recipientId });
});

app.post("/agent/medications/dosage", (req, res) => {
  const { recipientId = "rosa", medicationName, newDosage, newFrequency, reason, prescriber } = req.body ?? {};
  if (!medicationName || !newDosage || !newFrequency) {
    return res.status(400).json({ error: "medicationName, newDosage, and newFrequency are required" });
  }
  try {
    const entry = recordDosageChange(
      {
        medicationName,
        newDosage,
        newFrequency,
        reason,
        prescriber,
      },
      recipientId,
    );
    res.status(201).json({ success: true, entry });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Failed to record dosage change" });
  }
});

// Startup: verify agent wallet has USDC balance
async function verifyWallet() {
  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcBalance = account.balances.find(
      (b: any) =>
        b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER,
    );
    if (!usdcBalance) {
      logger.error(
        { wallet: agentKeypair.publicKey() },
        "agent wallet has no USDC trustline — fund at https://faucet.circle.com",
      );
      process.exit(1);
    }
    logger.info(
      {
        usdc: usdcBalance.balance,
        xlm:
          account.balances.find((b: any) => b.asset_type === "native")
            ?.balance || "0",
      },
      "wallet balances",
    );
  } catch (err: any) {
    logger.error(
      { err: err.message, wallet: agentKeypair.publicKey() },
      "failed to load agent wallet",
    );
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
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : String(req.body);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch (err) {
      logger.warn(
        {
          err,
          webhookId: req.headers["x-webhook-id"],
          bodyLength: rawBody.length,
        },
        "invalid JSON in stellar deposit webhook",
      );
      res.status(400).json({ error: "Invalid JSON in webhook payload" });
      return;
    }
    logger.info({ payload }, "stellar deposit webhook received");
    res.status(200).json({ status: "received" });
  },
);

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

let isDraining = false;
app.get("/ready", (_req, res) => {
  if (isDraining) {
    res.status(503).send("Service Unavailable");
    return;
  }
  res.send("OK");
});

export { app };

let server: ReturnType<typeof app.listen> | undefined;

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  server = app.listen(PORT, async () => {
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
      "CareGuard Agent started",
    );
    await verifyWallet();
    startOrderStatusReminderCron();
  });

  gracefulShutdown({ server, onDrainStart: () => { isDraining = true; } });
}

export { server };
