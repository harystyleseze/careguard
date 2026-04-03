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
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import {
  comparePharmacyPrices,
  auditBill,
  checkDrugInteractions,
  payForMedication,
  payBill,
  checkSpendingPolicy,
  getSpendingSummary,
  setSpendingPolicy,
  getSpendingTracker,
  resetSpendingTracker,
  TOOL_DEFINITIONS,
} from "./tools.js";

const PORT = parseInt(process.env.AGENT_PORT || "3004");

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required in .env");
if (!process.env.AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required in .env");

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

const llm = new OpenAI({
  apiKey: process.env.LLM_API_KEY,
  baseURL: LLM_BASE_URL,
});

const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET_KEY);
const horizonServer = new Horizon.Server("https://horizon-testnet.stellar.org");

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
- Report the total savings found and the cost of the agent's API queries

PAYMENT PROTOCOLS:
- API queries (pharmacy prices, bill audits, drug interactions) are paid via x402 on Stellar ($0.001-$0.01 per query)
- Medication orders are paid via MPP Charge on Stellar (USDC)
- Bill payments are direct Stellar USDC transfers
- All transactions settle on Stellar testnet with real USDC

Current care recipient: Rosa Garcia (age 78)
Caregiver: Maria Garcia (daughter)`;

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

// Execute a tool call
async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case "compare_pharmacy_prices": return await comparePharmacyPrices(input.drug_name, input.zip_code);
    case "audit_medical_bill": {
      const items = typeof input.line_items_json === "string" ? JSON.parse(input.line_items_json) : (input.line_items || input.line_items_json);
      return await auditBill(items);
    }
    case "check_drug_interactions": return await checkDrugInteractions(input.medications);
    case "pay_for_medication": return await payForMedication(input.pharmacy_id, input.pharmacy_name, input.drug_name, input.amount);
    case "pay_bill": return await payBill(input.provider_id, input.provider_name, input.description, input.amount);
    case "check_spending_policy": return checkSpendingPolicy(input.amount, input.category);
    case "get_spending_summary": return getSpendingSummary();
    default: return { error: `Unknown tool: ${name}` };
  }
}

// Run the agent with a task — full agentic loop
async function runAgent(task: string) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: task },
  ];
  const toolCalls: Array<{ tool: string; input: any; result: any }> = [];
  let finalResponse = "";

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
      console.error(`  ❌ LLM API error (iteration ${iteration}): ${llmErr.message}`);
      // If we already have tool results, summarize them instead of returning the error
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

    const choice = response.choices[0];
    if (!choice) break;

    const message = choice.message;
    messages.push(message);

    if (message.content) {
      finalResponse = message.content;
    }

    // If no tool calls, we're done
    if (!message.tool_calls || message.tool_calls.length === 0) break;

    // Execute tool calls
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const fnName = toolCall.function.name;
      let fnArgs: any;
      try {
        fnArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        fnArgs = {};
      }

      console.log(`  🔧 ${fnName}(${JSON.stringify(fnArgs).slice(0, 100)})`);

      let result: any;
      try {
        result = await executeTool(fnName, fnArgs);
        toolCalls.push({ tool: fnName, input: fnArgs, result });
      } catch (err: any) {
        console.error(`  ❌ ${fnName} error: ${err.message}`);
        result = { error: err.message };
        toolCalls.push({ tool: fnName, input: fnArgs, result });
      }

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    if (choice.finish_reason === "stop") break;
  }

  return { response: finalResponse, toolCalls, spending: getSpendingSummary() };
}

// Express API
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: "stellar:testnet",
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    careRecipient: "Rosa Garcia",
    caregiver: "Maria Garcia",
  });
});

app.post("/agent/run", async (req, res) => {
  const { task } = req.body;
  if (!task) { res.status(400).json({ error: "Missing 'task' in request body" }); return; }

  console.log(`\n🤖 Agent task: "${task.slice(0, 100)}..."`);

  try {
    const result = await runAgent(task);
    console.log(`  ✅ Done. ${result.toolCalls.length} tool calls.`);
    res.json(result);
  } catch (err: any) {
    console.error(`  ❌ Agent error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/agent/spending", (_req, res) => { res.json(getSpendingSummary()); });
app.get("/agent/transactions", (_req, res) => { res.json(getSpendingTracker()); });
app.post("/agent/policy", (req, res) => { setSpendingPolicy(req.body); res.json({ success: true, policy: req.body }); });
app.post("/agent/reset", (_req, res) => { resetSpendingTracker(); res.json({ success: true }); });

// Startup: verify agent wallet has USDC balance
async function verifyWallet() {
  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcBalance = account.balances.find((b: any) => b.asset_code === "USDC" && b.asset_issuer === process.env.USDC_ISSUER);
    if (!usdcBalance) {
      console.error(`\n❌ Agent wallet has no USDC trustline.`);
      console.error(`   Fund at https://faucet.circle.com (Stellar Testnet)`);
      console.error(`   Agent public key: ${agentKeypair.publicKey()}\n`);
      process.exit(1);
    }
    console.log(`   USDC balance: ${usdcBalance.balance}`);
    const xlmBalance = account.balances.find((b: any) => b.asset_type === "native");
    console.log(`   XLM balance: ${xlmBalance?.balance || "0"}`);
  } catch (err: any) {
    console.error(`\n❌ Failed to load agent wallet: ${err.message}`);
    console.error(`   Agent public key: ${agentKeypair.publicKey()}\n`);
    process.exit(1);
  }
}

app.listen(PORT, async () => {
  console.log(`\n🤖 CareGuard Agent running on http://localhost:${PORT}`);
  console.log(`   Network: stellar:testnet`);
  console.log(`   LLM: ${LLM_MODEL} via ${LLM_BASE_URL}`);
  console.log(`   Agent wallet: ${agentKeypair.publicKey()}`);
  await verifyWallet();
  console.log(`   Ready.\n`);
});
