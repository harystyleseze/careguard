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
import { buildScrubSession, scrubText } from "../shared/prompt-scrub.ts";
import { requestContextMiddleware, setAgentRunId, getRequestId } from "../shared/request-context.ts";
import { requestLoggerMiddleware } from "../shared/request-logger.ts";
import {
  metricsHandler,
  agentRunsTotal,
  agentToolCallsTotal,
  agentLlmTokensTotal,
  agentLlmIterationTokens,
  agentLlmContextUsageRatio, agentLlmErrorTotal,
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
  saveSpending,
  generateDisputeLetter,
  getAdherenceStatus,
  confirmAdherenceReminder,
  setCurrentRecipient,
  TOOL_DEFINITIONS,
  validateToolInput,
  SpendingPolicySchema,
} from "./tools.ts";
import {
  fetchToolResult,
  serializeToolResultForPrompt,
} from "./tool-result.ts";
import { getPendingAdherences } from "../shared/adherence.ts";
import { notify } from "../shared/notifications.ts";
import { resolveStellarNetwork, validateSignerKeyForNetwork } from "../shared/stellar-network.ts";
import { verifyWebhook } from "../shared/verify-webhook.ts";

const PORT = parseInt(process.env.AGENT_PORT || "3004");

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required in .env");
if (!process.env.AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required in .env");
if (!process.env.CAREGIVER_TOKEN) throw new Error("CAREGIVER_TOKEN required in .env");

const CAREGIVER_TOKEN = process.env.CAREGIVER_TOKEN;

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

// LLM Temperature configuration
// For tool-driven, deterministic agent behavior:
// - Tool-call rounds: temperature 0 (no variance, focused on function calling)
// - Final summary: temperature 0.3 (slight variance for natural phrasing)
const LLM_TOOL_TEMPERATURE = parseFloat(process.env.LLM_TOOL_TEMPERATURE || "0");
const LLM_SUMMARY_TEMPERATURE = parseFloat(process.env.LLM_SUMMARY_TEMPERATURE || "0.3");

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

function buildSystemPrompt(recipientProfile: RecipientProfile, caregiverName: string): string {
  const meds = (recipientProfile.medications ?? []).join(', ');
  return `You are CareGuard, an AI agent that manages healthcare spending for elderly care recipients on the Stellar blockchain. You work on behalf of a family caregiver to ensure their loved ones get the best prices on medications and catches errors in medical bills.

Your responsibilities:
1. MEDICATION MANAGEMENT: Compare prices across pharmacies and order from the cheapest. Always check drug interactions before ordering.
2. BILL AUDITING: Scan medical bills for errors (80% of bills have them). Identify duplicates, upcoding, and overcharges.
3. PAYMENT EXECUTION: Pay for medications and bills within the spending policy set by the caregiver. Never exceed policy limits.
4. ADHERENCE TRACKING: After ordering medications, track whether doses are taken. Prompt the caregiver to confirm adherence.
5. DISPUTE RESOLUTION: When audit finds overcharges, generate a dispute letter so the caregiver can act in one click.
6. TRANSPARENCY: Report all savings, errors found, and payments made. Every payment creates a real Stellar transaction.

IMPORTANT RULES:
- Always check spending policy BEFORE attempting any payment
- If a payment requires caregiver approval, flag it and wait — do not proceed
- If a payment is blocked by policy, explain why clearly
- When comparing medication prices, compare ALL medications at once, then check interactions, then order from cheapest
- Drug interaction checks require at least 2 medications; if the tool returns NEED_AT_LEAST_TWO_MEDS, ask for more meds instead of concluding "no interactions"
- When auditing a bill, use fetch_and_audit_bill which fetches the care recipient's bill and audits it in one step. Never invent bill data.
  ALLOWED:   Use the line items exactly as returned by the tool. Report the exact amounts, descriptions, and CPT codes.
  DISALLOWED: Do not add, extrapolate, or fabricate any line item, amount, or CPT code that was not in the tool output.
  Example: If the tool returns "Chest X-ray: $180", do not change it to "Chest X-ray: $200" or add "MRI: $1000".
- Report the total savings found and the cost of the agent's API queries
- After paying for medication, schedule an adherence reminder
- When audit errors are found, offer to generate a dispute letter via generate_dispute_letter
- If a tool result is truncated and includes resultId or a summary, call fetch_tool_result to page through the remaining data before making conclusions

PAYMENT PROTOCOLS:
- API queries (pharmacy prices, bill audits, drug interactions) are paid via x402 on Stellar ($0.001-$0.01 per query)
- Medication orders are paid via MPP Charge on Stellar (USDC)
- Bill payments are direct Stellar USDC transfers
- All transactions settle on Stellar testnet with real USDC

Current care recipient: ${recipientProfile.name} (age ${recipientProfile.age ?? 'unknown'})
Medications: ${meds || 'none listed'}
Caregiver: ${caregiverName}
Use recipient_id parameter when making tool calls that support it.`;
}

// PHI scrubbing — active unless LLM_PII_SCRUB=false (e.g. provider has a BAA)
const _piiScrub = process.env.LLM_PII_SCRUB !== "false";

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

async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    input = validateToolInput(name, input);
    let result: any;
    const rid = (input.recipient_id as string) || "rosa";
    setCurrentRecipient(rid);
    const dName = input.drug_name as string | undefined;
    const dosage = input.dosage as string | undefined;
    const zip = input.zip_code as string | undefined;
    const pharmId = input.pharmacy_id as string | undefined;
    const pharmName = input.pharmacy_name as string | undefined;
    const drugN = input.drug_name as string | undefined;
    const amt = parseFloat(input.amount as string);
    const provId = input.provider_id as string | undefined;
    const provName = input.provider_name as string | undefined;
    const desc = input.description as string | undefined;
    const cat = input.category as string | undefined;

    switch (name) {
      case "compare_pharmacy_prices": result = await comparePharmacyPrices(dName || "", zip, dosage); break;
      case "audit_medical_bill": {
        let items;
        if (typeof input.line_items_json === "string") {
          try {
            items = JSON.parse(input.line_items_json);
          } catch (e: any) {
            const sample = input.line_items_json.slice(0, 200);
            agentToolCallsTotal.inc({ tool: name, status: "error" });
            return {
              ok: false,
              reason: "INVALID_LINE_ITEMS_JSON",
              message: "line_items_json must be valid JSON",
              sample,
              error: e.message,
            };
          }
        } else {
          items = input.line_items || input.line_items_json;
        }
        result = await auditBill(items);
        break;
      }
      case "fetch_rosa_bill": result = await fetchRosaBill(); break;
      case "fetch_and_audit_bill": result = await fetchAndAuditBill(); break;
      case "check_drug_interactions": result = await checkDrugInteractions(input.medications as string[]); break;
      case "fetch_tool_result": result = fetchToolResult(input.result_id as string, Number(input.offset ?? 0), Number(input.limit ?? 10)); break;
      case "pay_for_medication": result = await payForMedication(pharmId || "", pharmName || "", drugN || "", amt); break;
      case "pay_bill": result = await payBill(provId || "", provName || "", desc || "", amt); break;
      case "check_spending_policy": result = checkSpendingPolicy(amt, cat as "medications" | "bills"); break;
      case "get_spending_summary": result = getSpendingSummary(); break;
      case "get_wallet_balance": result = await getWalletBalance(); break;
      case "generate_dispute_letter": {
        let auditResult: any;
        if (typeof input.audit_result_json === "string") {
          try {
            auditResult = JSON.parse(input.audit_result_json);
          } catch (e: any) {
            return { ok: false, reason: "INVALID_AUDIT_RESULT_JSON", error: e.message };
          }
        } else {
          auditResult = input.audit_result_json;
        }
        result = generateDisputeLetter(
          input.bill_id as string,
          (input.error_descriptions as string[]) || [],
          auditResult,
          {
            name: input.recipient_name as string,
            facility: input.facility as string,
            caregiverName: input.caregiver_name as string,
            caregiverEmail: input.caregiver_email as string,
          }
        );
        break;
      }
      case "get_adherence_status": result = getAdherenceStatus(rid); break;
      case "confirm_adherence": result = confirmAdherenceReminder(input.record_id as string); break;
      default: result = { error: `Unknown tool: ${name}` };
    }
    agentToolCallsTotal.inc({ tool: name, status: "success" });
    return result;
  } catch (err: any) {
    agentToolCallsTotal.inc({ tool: name, status: "error" });
    throw err;
  }
}


// Calculate max_tokens based on iteration context and prior complexity
// Heuristic: 512 for processing tool results, 1024 for simple queries, 4096 for summaries
function calculateMaxTokens(iteration: number, toolCallCount: number, previousToolResultCount: number): number {
  // First iteration with no priors: likely a simple query
  if (iteration === 0) {
    return LLM_MAX_TOKENS_SIMPLE; // 1024
  }

  // Just processed multiple tool results: need to synthesize them (still modest)
  if (previousToolResultCount > 0 && previousToolResultCount <= 3) {
    return LLM_MAX_TOKENS_TOOL_RESULT; // 512
  }

  // Multiple tool results or complex scenario: save budget but allow more
  if (previousToolResultCount > 3) {
    return LLM_MAX_TOKENS_SIMPLE; // 1024
  }

  // Late iterations: likely final summary, give full budget
  if (iteration > 8) {
    return LLM_MAX_TOKENS_SUMMARY; // 4096
  }

  // Default: conservative middle ground
  return LLM_MAX_TOKENS_SIMPLE; // 1024
}

// Run the agent with a task — full agentic loop
async function runAgent(task: string) {
  const activeRecipient = recipientProfiles.rosa ?? Object.values(recipientProfiles)[0];
  const systemPrompt = buildSystemPrompt(activeRecipient, caregiverProfile.name);
  const scrubSession = _piiScrub
    ? buildScrubSession([activeRecipient.name], [caregiverProfile.name])
    : null;
  const userTask = scrubSession ? scrubText(task, scrubSession) : task;
  const scrubbedSystemPrompt = scrubSession ? scrubText(systemPrompt, scrubSession) : systemPrompt;
  const runId = `run-${getRequestId() ?? Date.now()}`;
  setAgentRunId(runId);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: scrubbedSystemPrompt },
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
      // Determine temperature based on whether this is a tool-call round or final summary
      // Tool-call rounds use temperature=0 for deterministic tool selection
      // Final summary (when no tools will be called) uses temperature=0.3 for natural phrasing
      const isToolCallRound = toolCalls.length > 0 || iteration < 14; // Assume tool calls unless it's the last iteration
      const temperature = isToolCallRound ? LLM_TOOL_TEMPERATURE : LLM_SUMMARY_TEMPERATURE;
      
      // Calculate max_tokens based on iteration context to optimize budget
      const maxTokens = calculateMaxTokens(iteration, runToolCalls, toolCalls.length);
      
      response = await llm.chat.completions.create({
        model: LLM_MODEL,
        temperature,
        max_tokens: maxTokens,
        tools: LLM_TOOLS,
        messages,
      });
    } catch (llmErr: any) {
      logger.error({ err: llmErr.message, iteration }, "LLM API error");
      agentLlmErrorTotal.inc();
      finalResponse = JSON.stringify({
        status: "llm_error",
        toolCallsCompleted: toolCalls.length,
        message: `LLM API error: ${llmErr.message}. Agent run was interrupted — not all tool calls may have completed.`,
        toolCalls: toolCalls.map(tc => ({
          tool: tc.tool,
          input: tc.input,
          result: tc.result,
        })),
      });
      if (toolCalls.length > 0 && !finalResponse) {
        finalResponse = toolCalls.map(tc => {
          if (tc.result?.error) return `${tc.tool}: ${tc.result.error}`;
          if (tc.result?.ok === false && tc.result?.reason) return `${tc.tool}: ${tc.result.reason}`;
          if (tc.tool === "compare_pharmacy_prices" && (tc.result as any)?.cheapest) return `${(tc.result as any).drug}: cheapest at $${(tc.result as any).cheapest.price} (${(tc.result as any).cheapest.pharmacyName}), save $${(tc.result as any).potentialSavings}/mo`;
          if (tc.tool === "audit_medical_bill" && (tc.result as any)?.totalOvercharge) return `Bill audit: $${(tc.result as any).totalOvercharge} in overcharges found (${(tc.result as any).errorCount} errors)`;
          if (tc.tool === "check_drug_interactions" && (tc.result as any)?.summary) return (tc.result as any).summary;
          if (tc.tool === "pay_for_medication" && (tc.result as any)?.success) return `Paid $${(tc.result as any).transaction.amount} for ${(tc.result as any).transaction.description}`;
          if (tc.tool === "pay_bill" && (tc.result as any)?.success) return `Paid bill: $${(tc.result as any).transaction.amount}`;
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
      agentLlmIterationTokens.set({ kind: "prompt" }, promptTokens);
      agentLlmIterationTokens.set({ kind: "completion" }, completionTokens);
      agentLlmIterationTokens.set({ kind: "total" }, promptTokens + completionTokens);
      const contextWindow = parseInt(process.env.LLM_CONTEXT_WINDOW || "32768", 10);
      const usageRatio = contextWindow > 0 ? (promptTokens + completionTokens) / contextWindow : 0;
      agentLlmContextUsageRatio.set(usageRatio);
      if (usageRatio >= 0.8) {
        logger.warn(
          {
            iteration,
            promptTokens,
            completionTokens,
            usageRatio,
            contextWindow,
          },
          "LLM context usage reached 80% of the configured window",
        );
      }
    }

    const choice = response.choices[0];
    if (!choice) break;

    const message = choice.message;
    messages.push(message);

    if (typeof message.content === 'string') {
      // Accept empty-string content as an explicit empty response from the LLM
      // to avoid leaking previous-iteration text as a stale final response.
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

      const toolContent = serializeToolResultForPrompt(fnName, result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolContent,
      });
    }

    if (choice.finish_reason === "stop") break;
  }

  // Track token usage for alerting on sustained high consumption
  const totalRunTokens = llmUsage.promptTokens + llmUsage.completionTokens;
  tokenStats.totalTokens += totalRunTokens;
  tokenStats.runCount += 1;
  tokenStats.averagePerRun = tokenStats.totalTokens / tokenStats.runCount;
  
  const averageUsageRatio = tokenStats.averagePerRun / LLM_MAX_TOKENS_SUMMARY;
  if (averageUsageRatio > TOKEN_USAGE_THRESHOLD_RATIO) {
    logger.warn(
      {
        currentRunTokens: totalRunTokens,
        averageTokensPerRun: Math.round(tokenStats.averagePerRun),
        averageUsageRatio: (averageUsageRatio * 100).toFixed(1) + "%",
        runCount: tokenStats.runCount,
        maxTokensPerRun: LLM_MAX_TOKENS_SUMMARY,
      },
      "LLM token usage exceeds 50% of budget threshold — consider optimizing prompts or increasing max_tokens"
    );
  }

  return { response: finalResponse, toolCalls, spending: getSpendingSummary(), llmUsage, truncated };
}

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

// Express API
const app: Express = express();

app.use("/agent", requireCaregiverToken);
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
  res.json({ paused: true });
});
app.post("/agent/resume", (_req, res) => {
  agentPaused = false;
  logger.info("agent resumed by caregiver");
  notify({ level: "info", title: "Agent Resumed", description: "CareGuard agent has been resumed and is now processing actions." });
  res.json({ paused: false });
});

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
  res.json({ success: true, policy: result.data, recipientId });
});
app.post("/agent/reset", (req, res) => {
  const recipientId = (req.query.recipient_id as string) || "rosa";
  setCurrentRecipient(recipientId);
  resetSpendingTracker();
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
