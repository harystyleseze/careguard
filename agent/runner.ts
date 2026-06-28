/**
 * Shared agent runner — extracted from agent/server.ts and server.ts (issue #10).
 *
 * Exports executeTool(), runAgent(), and SYSTEM_PROMPT so both the standalone
 * agent server and the unified server import from a single source of truth.
 */

import { createHash } from "crypto";
import OpenAI from "openai";
import { logger } from "../shared/logger.ts";
import { appendAuditEntry } from "../shared/audit-log.ts";
import { buildScrubSession, scrubText } from "../shared/prompt-scrub.ts";
import { setAgentRunId, getRequestId } from "../shared/request-context.ts";
import {
  agentToolCallsTotal,
  agentLlmTokensTotal,
  agentLlmIterationTokens,
  agentLlmContextUsageRatio,
  agentLlmErrorTotal,
  agentIterationLimitTotal,
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
} from "./tools.ts";
import {
  fetchToolResult,
  serializeToolResultForPrompt,
} from "./tool-result.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToolResult = Record<string, unknown>;

export interface AgentProfile {
  recipient: {
    name: string;
    age?: number | null;
    medications?: string[];
  };
  caregiver: {
    name: string;
  };
}

export interface RunAgentOptions {
  task: string;
  profile: AgentProfile;
  llm: OpenAI;
  model: string;
  maxIterations?: number;
  maxToolCallsPerRun?: number;
  llmToolTemperature?: number;
  llmSummaryTemperature?: number;
  llmMaxTokensToolResult?: number;
  llmMaxTokensSimple?: number;
  llmMaxTokensSummary?: number;
  llmContextWindow?: number;
  piiScrub?: boolean;
}

export interface RunAgentResult {
  response: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown>; result: ToolResult }>;
  spending: ReturnType<typeof getSpendingSummary>;
  llmUsage: { promptTokens: number; completionTokens: number };
  truncated: boolean;
  events: Array<{ kind: string }>;
  error?: { message: string; code?: string; iteration: number };
}

// ── System prompt ──────────────────────────────────────────────────────────────

export function buildSystemPrompt(profile: AgentProfile, caregiverName: string): string {
  const meds = (profile.recipient.medications ?? []).join(", ");
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
- Report the total savings found and the cost of the agent's API queries
- After paying for medication, schedule an adherence reminder
- When audit errors are found, offer to generate a dispute letter via generate_dispute_letter
- If a tool result is truncated and includes resultId or a summary, call fetch_tool_result to page through the remaining data before making conclusions

PAYMENT PROTOCOLS:
- API queries (pharmacy prices, bill audits, drug interactions) are paid via x402 on Stellar ($0.001-$0.01 per query)
- Medication orders are paid via MPP Charge on Stellar (USDC)
- Bill payments are direct Stellar USDC transfers
- All transactions settle on Stellar testnet with real USDC

Current care recipient: ${profile.recipient.name} (age ${profile.recipient.age ?? "unknown"})
Medications: ${meds || "none listed"}
Caregiver: ${caregiverName}
Use recipient_id parameter when making tool calls that support it.`;
}

// ── LLM tool definitions ───────────────────────────────────────────────────────

export const LLM_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      ...t.input_schema,
      additionalProperties: false,
    },
  },
}));

// ── executeTool ───────────────────────────────────────────────────────────────

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
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
      case "compare_pharmacy_prices":
        result = await comparePharmacyPrices(dName || "", zip, dosage);
        break;
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
      case "fetch_rosa_bill":
        result = await fetchRosaBill();
        break;
      case "fetch_and_audit_bill":
        result = await fetchAndAuditBill();
        break;
      case "check_drug_interactions":
        result = await checkDrugInteractions(input.medications as string[]);
        break;
      case "fetch_tool_result":
        result = fetchToolResult(
          input.result_id as string,
          Number(input.offset ?? 0),
          Number(input.limit ?? 10),
        );
        break;
      case "pay_for_medication":
        result = await payForMedication(pharmId || "", pharmName || "", drugN || "", amt);
        break;
      case "pay_bill":
        result = await payBill(provId || "", provName || "", desc || "", amt);
        break;
      case "check_spending_policy":
        result = checkSpendingPolicy(amt, cat as "medications" | "bills");
        break;
      case "get_spending_summary":
        result = getSpendingSummary();
        break;
      case "get_wallet_balance":
        result = await getWalletBalance();
        break;
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
          },
        );
        break;
      }
      case "get_adherence_status":
        result = getAdherenceStatus(rid);
        break;
      case "confirm_adherence":
        result = confirmAdherenceReminder(input.record_id as string);
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

// ── Token budget helpers ───────────────────────────────────────────────────────

function calculateMaxTokens(
  iteration: number,
  maxIterations: number,
  previousToolResultCount: number,
  maxTokensToolResult: number,
  maxTokensSimple: number,
  maxTokensSummary: number,
): number {
  if (iteration === 0) return maxTokensSimple;
  if (previousToolResultCount > 0 && previousToolResultCount <= 3) return maxTokensToolResult;
  if (previousToolResultCount > 3) return maxTokensSimple;
  if (iteration > 8) return maxTokensSummary;
  return maxTokensSimple;
}

// ── runAgent ──────────────────────────────────────────────────────────────────

export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const {
    task,
    profile,
    llm,
    model,
    maxIterations = 15,
    maxToolCallsPerRun = 30,
    llmToolTemperature = 0,
    llmSummaryTemperature = 0.3,
    llmMaxTokensToolResult = 512,
    llmMaxTokensSimple = 1024,
    llmMaxTokensSummary = 4096,
    llmContextWindow = 32768,
    piiScrub = true,
  } = opts;

  const systemPrompt = buildSystemPrompt(profile, profile.caregiver.name);
  const scrubSession = piiScrub
    ? buildScrubSession([profile.recipient.name], [profile.caregiver.name])
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
  let llmUsage = { promptTokens: 0, completionTokens: 0 };
  let runToolCalls = 0;
  let truncated = false;
  const events: Array<{ kind: string }> = [];
  let llmError: RunAgentResult["error"] | undefined;

  let iteration = 0;
  for (; iteration < maxIterations; iteration++) {
    let response;
    try {
      const isToolCallRound = toolCalls.length > 0 || iteration < maxIterations - 1;
      const temperature = isToolCallRound ? llmToolTemperature : llmSummaryTemperature;
      const maxTokens = calculateMaxTokens(
        iteration,
        maxIterations,
        toolCalls.length,
        llmMaxTokensToolResult,
        llmMaxTokensSimple,
        llmMaxTokensSummary,
      );

      response = await llm.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        tools: LLM_TOOLS,
        messages,
      });
    } catch (llmErr: any) {
      logger.error({ err: llmErr.message, iteration }, "LLM API error");
      agentLlmErrorTotal.inc();

      llmError = { message: llmErr.message, code: llmErr.code, iteration };

      const partialSummary = toolCalls.length > 0
        ? toolCalls.map((tc) => {
            if (tc.result?.error) return `${tc.tool}: ${tc.result.error}`;
            if (tc.result?.ok === false && (tc.result as any)?.reason) return `${tc.tool}: ${(tc.result as any).reason}`;
            if (tc.tool === "compare_pharmacy_prices" && (tc.result as any)?.cheapest)
              return `${(tc.result as any).drug}: cheapest at $${(tc.result as any).cheapest.price} (${(tc.result as any).cheapest.pharmacyName}), save $${(tc.result as any).potentialSavings}/mo`;
            if (tc.tool === "audit_medical_bill" && (tc.result as any)?.totalOvercharge)
              return `Bill audit: $${(tc.result as any).totalOvercharge} in overcharges found (${(tc.result as any).errorCount} errors)`;
            if (tc.tool === "check_drug_interactions" && (tc.result as any)?.summary)
              return (tc.result as any).summary;
            if (tc.tool === "pay_for_medication" && (tc.result as any)?.success)
              return `Paid $${(tc.result as any).transaction.amount} for ${(tc.result as any).transaction.description}`;
            if (tc.tool === "pay_bill" && (tc.result as any)?.success)
              return `Paid bill: $${(tc.result as any).transaction.amount}`;
            return `${tc.tool}: completed`;
          }).join("\n")
        : `LLM error: ${llmErr.message}`;

      finalResponse = `⚠ LLM error at iteration ${iteration} — results below are partial\n\n${partialSummary}`;
      break;
    }

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
      const usageRatio = llmContextWindow > 0 ? (promptTokens + completionTokens) / llmContextWindow : 0;
      agentLlmContextUsageRatio.set(usageRatio);
      if (usageRatio >= 0.8) {
        logger.warn({ iteration, promptTokens, completionTokens, usageRatio, llmContextWindow }, "LLM context usage reached 80% of the configured window");
      }
    }

    const choice = response.choices[0];
    if (!choice) break;

    const message = choice.message;
    messages.push(message);

    if (typeof message.content === "string") {
      finalResponse = message.content;
    }

    if (!message.tool_calls || message.tool_calls.length === 0) break;

    if (runToolCalls + message.tool_calls.length > maxToolCallsPerRun) {
      truncated = true;
      appendAuditEntry({
        event: "agent.tool_cap_exceeded",
        actor: "agent",
        details: { max: maxToolCallsPerRun, ran: runToolCalls },
      });
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
          resultHash: createHash("sha256").update(JSON.stringify(result || {})).digest("hex"),
        },
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

  if (iteration >= maxIterations) {
    events.push({ kind: "iteration_limit_reached" });
    agentIterationLimitTotal.inc();
    appendAuditEntry({
      event: "agent.iteration_limit_reached",
      actor: "agent",
      details: { maxIterations },
    });
    logger.warn({ maxIterations }, "agent run hit iteration limit");
  }

  const result: RunAgentResult = {
    response: finalResponse,
    toolCalls,
    spending: getSpendingSummary(),
    llmUsage,
    truncated,
    events,
  };

  if (llmError) {
    result.error = llmError;
  }

  return result;
}
