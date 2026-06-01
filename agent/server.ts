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
import express from "express";
import OpenAI from "openai";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import { createCorsMiddleware } from "../shared/cors.ts";
import { applySecurityMiddleware } from "../shared/security-middleware.ts";
import { logger } from "../shared/logger.ts";
import { validateTask, getSuspiciousTaskCount } from "../shared/task-validation.ts";
import { appendAuditEntry, auditRouter } from "../shared/audit-log.ts";
import { rateLimiters } from "../shared/rate-limit.ts";
import { agentQueue } from "../shared/agent-queue.ts";
import { buildScrubSession, scrubText } from "../shared/prompt-scrub.ts";
import { requestContextMiddleware, setAgentRunId, getRequestId } from "../shared/request-context.ts";
import { requestLoggerMiddleware } from "../shared/request-logger.ts";
import {
  metricsHandler,
  agentRunsTotal,
  agentToolCallsTotal,
  agentLlmTokensTotal,
} from "../shared/metrics.ts";
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
  getWalletBalance,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  TOOL_DEFINITIONS,
} from "./tools.ts";

const PORT = parseInt(process.env.AGENT_PORT || "3004");

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required in .env");
if (!process.env.AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required in .env");
if (!process.env.CAREGIVER_TOKEN) throw new Error("CAREGIVER_TOKEN required in .env");

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

const llm = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: LLM_BASE_URL,
});

const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET_KEY);
const horizonServer = new Horizon.Server("https://horizon-testnet.stellar.org");
const CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN;

const SYSTEM_PROMPT = `You are CareGuard, an AI agent that manages healthcare spending for elderly care recipients on the Stellar blockchain. You work on behalf of a family caregiver to ensure their loved one gets the best prices on medications and catches errors in medical bills.

Your responsibilities:
1. MEDICATION MANAGEMENT: Compare prices across pharmacies and order from the cheapest. Always check drug interactions before ordering.
2. BILL AUDITING: Scan medical bills for errors (80% of bills have them). Identify duplicates, upcoding, and overcharges.
3. PAYMENT EXECUTION: Pay for medications and bills within the spending policy set by the caregiver. Never exceed policy limits.
4. TRANSPARENCY: Report all savings, errors found, and payments made. Every payment creates a real Stellar transaction.

IMPORTANT RULES:
- Always check spending policy BEFORE attempting any payment
- If a payment requires caregiver approval, flag it and wait — do not proceed
- If a payment is blocked by policy, explain why clearly
- When comparing medication prices, compare ALL medications at once, then check interactions, then order from cheapest
- When auditing a bill, use fetch_and_audit_bill which fetches Rosa's bill and audits it in one step. Never invent. The only billing data source is fetch_rosa_bill, which returns a sample bill for the demo. In production this is replaced with real EDI feeds.
- Report the total savings found and the cost of the agent's API queries

PAYMENT PROTOCOLS:
- API queries (pharmacy prices, bill audits, drug interactions) are paid via x402 on Stellar ($0.001-$0.01 per query)
- Medication orders are paid via MPP Charge on Stellar (USDC)
- Bill payments are direct Stellar USDC transfers
- All transactions settle on Stellar testnet with real USDC

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

// Convert tool definitions to OpenAI-compatible function format
const LLM_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      ...t.input_schema,
      // Strict mode: required by Groq and other providers
      additionalProperties: false,
    },
  },
}));

type ToolResult = Record<string, unknown>;

// Execute a tool call
async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    let result: any;
    switch (name) {
      case "compare_pharmacy_prices": result = await comparePharmacyPrices(input.drug_name, input.zip_code); break;
      case "audit_medical_bill": {
        let items;
        if (typeof input.line_items_json === "string") {
          try {
            items = JSON.parse(input.line_items_json);
          } catch (e: any) {
            const sample = input.line_items_json.slice(0, 200);
            agentToolCallsTotal.inc({ tool: name, status: "error" });
            return { ok: false, reason: "INVALID_LINE_ITEMS_JSON", sample, error: e.message };
          }
        } else {
          items = input.line_items || input.line_items_json;
        }
        result = await auditBill(items);
        break;
      }
      case "fetch_rosa_bill": result = await fetchRosaBill(); break;
      case "fetch_and_audit_bill": result = await fetchAndAuditBill(); break;
      case "check_drug_interactions": result = await checkDrugInteractions(input.medications); break;
      case "pay_for_medication": result = await payForMedication(input.pharmacy_id, input.pharmacy_name, input.drug_name, parseFloat(input.amount)); break;
      case "pay_bill": result = await payBill(input.provider_id, input.provider_name, input.description, parseFloat(input.amount)); break;
      case "check_spending_policy": result = checkSpendingPolicy(parseFloat(input.amount), input.category); break;
      case "get_spending_summary": result = getSpendingSummary(); break;
      case "get_wallet_balance": result = await getWalletBalance(); break;
      default: result = { error: `Unknown tool: ${name}` };
    }
    agentToolCallsTotal.inc({ tool: name, status: "success" });
    return result;
  } catch (err: any) {
    agentToolCallsTotal.inc({ tool: name, status: "error" });
    throw err;
  }
}


// Run the agent with a task — full agentic loop
async function runAgent(task: string) {
  const userTask = _scrubSession ? scrubText(task, _scrubSession) : task;
  const runId = `run-${getRequestId() ?? Date.now()}`;
  setAgentRunId(runId);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SCRUBBED_SYSTEM_PROMPT },
    { role: "user", content: userTask },
  ];
  const toolCalls: Array<{ tool: string; input: Record<string, unknown>; result: ToolResult }> = [];
  let finalResponse = "";
  let llmUsage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
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
    } catch (llmErr: any) {
      logger.error({ err: llmErr.message, iteration }, "LLM API error");
      if (toolCalls.length > 0 && !finalResponse) {
        finalResponse = toolCalls.map(tc => {
          if (tc.result?.error) return `${tc.tool}: ${tc.result.error}`;
          if (tc.tool === "compare_pharmacy_prices" && tc.result?.cheapest) return `${tc.result.drug}: cheapest at $${tc.result.cheapest.price} (${tc.result.cheapest.pharmacyName}), save $${tc.result.potentialSavings}/mo`;
          if (tc.tool === "audit_medical_bill" && tc.result?.totalOvercharge) return `Bill audit: $${tc.result.totalOvercharge} in overcharges found (${tc.result.errorCount} errors)`;
          if (tc.tool === "check_drug_interactions" && tc.result?.summary) return tc.result.summary;
          if (tc.tool === "pay_for_medication" && tc.result?.success) return `Paid $${tc.result.transaction.amount} for ${tc.result.transaction.description}`;
          if (tc.tool === "pay_bill" && tc.result?.success) return `Paid bill: $${tc.result.transaction.amount}`;
          return `${tc.tool}: completed`;
        }).join("\n");
      } else if (!finalResponse) {
        finalResponse = `LLM error: ${llmErr.message}`;
      }
      break;
    }

    // Capture token usage
    if (response.usage) {
      const promptTokens = response.usage.prompt_tokens || 0;
      const completionTokens = response.usage.completion_tokens || 0;
      llmUsage.promptTokens += promptTokens;
      llmUsage.completionTokens += completionTokens;
      agentLlmTokensTotal.inc({ kind: "prompt" }, promptTokens);
      agentLlmTokensTotal.inc({ kind: "completion" }, completionTokens);
    }

    const choice = response.choices[0];
    if (!choice) break;

    const message = choice.message;
    messages.push(message);

    if (message.content) {
      finalResponse = message.content;
    }

    if (!message.tool_calls || message.tool_calls.length === 0) break;

    // Cap at iteration boundary — breaking mid-batch would orphan tool_call_ids
    if (runToolCalls + message.tool_calls.length > MAX_TOOL_CALLS_PER_RUN) {
      toolCallCapHitsTotal++;
      truncated = true;
      appendAuditEntry({ event: "agent.tool_cap_exceeded", actor: "agent", details: { max: MAX_TOOL_CALLS_PER_RUN, ran: runToolCalls } });
      finalResponse = finalResponse || "Tool call limit reached; partial results returned.";
      break;
    }
    runToolCalls += message.tool_calls.length;

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const fnName = toolCall.function.name;
      let fnArgs: any;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        fnArgs = {};
      }

      logger.info({ tool: fnName, args: JSON.stringify(fnArgs).slice(0, 100) }, "tool call");

      let result: ToolResult;
      try {
        result = await executeTool(fnName, fnArgs);
        toolCalls.push({ tool: fnName, input: fnArgs, result });
      } catch (err: any) {
        logger.error({ tool: fnName, err: err.message }, "tool error");
        result = { error: err.message };
        toolCalls.push({ tool: fnName, input: fnArgs, result });
      }

      appendAuditEntry({
        event: "tool_call",
        actor: "agent",
        details: {
          tool: fnName,
          inputs: fnArgs,
          resultHash: createHash("sha256").update(JSON.stringify(result || {})).digest("hex")
        }
      });

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    if (choice.finish_reason === "stop") break;
  }

  return { response: finalResponse, toolCalls, spending: getSpendingSummary(), llmUsage, truncated };
}

// Express API
const app = express();

function requireCaregiverToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).setHeader("WWW-Authenticate", "Bearer").json({ error: "Missing caregiver token" });
    return;
  }
  if (auth.slice("Bearer ".length) !== CAREGIVER_TOKEN) {
    res.status(403).json({ error: "Invalid caregiver token" });
    return;
  }
  next();
}

app.use("/agent", rateLimiters.agent);
app.use("/health", rateLimiters.health);
app.use(rateLimiters.default);

applySecurityMiddleware(app);
app.use(createCorsMiddleware());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT ?? "20kb" }));
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());
app.use("/agent", requireCaregiverToken);
app.use("/agent/audit", auditRouter);
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
app.get("/agent/pending-approvals", (_req, res) => {
  const tracker = getSpendingTracker();
  const pending = tracker.transactions.filter((t: any) => t.status === "pending");
  res.json({ approvals: pending });
});

// Approve or reject a pending transaction
app.post("/agent/approvals/:txId", async (req, res) => {
  const { txId } = req.params;
  const { approve } = req.body;
  const tracker = getSpendingTracker();
  const txIndex = tracker.transactions.findIndex((t: any) => t.id === txId);
  if (txIndex === -1) return res.status(404).json({ error: "Transaction not found" });
  const tx = tracker.transactions[txIndex];
  if (tx.status !== "pending") return res.status(400).json({ error: "Transaction is not pending" });

  if (!approve) {
    tx.status = "rejected";
    saveSpending(tracker);
    return res.json({ success: true, status: "rejected" });
  }

  // Approve: re-execute the payment bypassing approval gate
  try {
    let result;
    if (tx.category === "medications") {
      // Extract details from description: "Drug from Pharmacy"
      const match = tx.description.match(/(.+) from (.+)/);
      if (!match) throw new Error("Cannot parse transaction description");
      const [, drugName, pharmacyName] = match;
      // Find pharmacy ID from description or use a default
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
      tx.status = "rejected";
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
    careRecipient: "Rosa Garcia",
    caregiver: "Maria Garcia",
    paused: agentPaused,
  });
});

app.get("/agent/status", (_req, res) => { res.json({ paused: agentPaused }); });
app.post("/agent/pause", (_req, res) => { agentPaused = true; logger.info("agent paused by caregiver"); res.json({ paused: true }); });
app.post("/agent/resume", (_req, res) => { agentPaused = false; logger.info("agent resumed by caregiver"); res.json({ paused: false }); });

app.post("/agent/run", async (req, res) => {
  const validation = validateTask(req.body?.task);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }
  if (agentPaused) { res.status(409).json({ error: "Agent is paused. Resume from the dashboard to continue.", paused: true }); return; }

  const task = validation.task!;
  logger.info({ task, suspicious: validation.suspicious }, "agent task received");

  try {
    const result = await agentQueue.enqueue(() => runAgent(task));
    agentRunsTotal.inc({ status: "success" });
    logger.info({ toolCalls: result.toolCalls.length, truncated: result.truncated, promptTokens: result.llmUsage.promptTokens, completionTokens: result.llmUsage.completionTokens }, "agent task complete");
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

app.get("/agent/spending", (_req, res) => { res.json(getSpendingSummary()); });
app.get("/agent/transactions", (_req, res) => { res.json(getSpendingTracker()); });
function validatePolicyPayload(body: any): { ok: true; policy: any } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== "object") return { ok: false, errors: ["body must be a JSON object"] };
  const fields = ["dailyLimit", "monthlyLimit", "medicationMonthlyBudget", "billMonthlyBudget", "approvalThreshold"] as const;
  for (const f of fields) {
    const v = body[f];
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${f} must be a finite number`);
    else if (v <= 0) errors.push(`${f} must be greater than 0`);
  }
  if (typeof body.dailyLimit === "number" && typeof body.monthlyLimit === "number" && body.dailyLimit > body.monthlyLimit) {
    errors.push("dailyLimit cannot exceed monthlyLimit");
  }
  if (typeof body.approvalThreshold === "number" && typeof body.dailyLimit === "number" && body.approvalThreshold > body.dailyLimit) {
    errors.push("approvalThreshold cannot exceed dailyLimit");
  }
  if (errors.length > 0) return { ok: false, errors };
  const policy = Object.fromEntries(fields.map((f) => [f, body[f]]));
  return { ok: true, policy };
}

app.post("/agent/policy", (req, res) => {
  const result = validatePolicyPayload(req.body);
  if (!result.ok) return res.status(400).json({ error: "Invalid policy", details: result.errors });
  setSpendingPolicy(result.policy);
  res.json({ success: true, policy: result.policy });
});
app.post("/agent/reset", (_req, res) => { resetSpendingTracker(); res.json({ success: true }); });

const DEFAULT_PROFILE = {
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

let profileData = {
  recipient: { ...DEFAULT_PROFILE.recipient, medications: [...DEFAULT_PROFILE.recipient.medications] },
  caregiver: { ...DEFAULT_PROFILE.caregiver },
};

app.get("/agent/profile", (_req, res) => { res.json(profileData); });

app.patch("/agent/profile", (req, res) => {
  const { recipient, caregiver } = req.body ?? {};
  if (recipient && typeof recipient === "object") {
    profileData.recipient = { ...profileData.recipient, ...recipient };
    if (Array.isArray(recipient.medications)) {
      profileData.recipient.medications = recipient.medications;
    }
  }
  if (caregiver && typeof caregiver === "object") {
    profileData.caregiver = { ...profileData.caregiver, ...caregiver };
  }
  res.json(profileData);
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
  logger.info({ port: PORT, network: "stellar:testnet", llm: LLM_MODEL, llmBaseUrl: LLM_BASE_URL, wallet: agentKeypair.publicKey() }, "CareGuard Agent started");
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
