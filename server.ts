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
import express from "express";
import cors from "cors";
import { Keypair, Horizon } from "@stellar/stellar-sdk";
import OpenAI from "openai";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { USDC_SAC_TESTNET } from "@stellar/mpp";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

// x402 middleware
import { applyX402Middleware } from "./shared/x402-middleware.ts";

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
} from "./agent/tools.ts";

// --- Environment ---
const PORT = parseInt(process.env.PORT || "3004");

if (!process.env.LLM_API_KEY) throw new Error("LLM_API_KEY required");
if (!process.env.AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required");
if (!process.env.PHARMACY_1_PUBLIC_KEY) throw new Error("PHARMACY_1_PUBLIC_KEY required");
if (!process.env.BILL_PROVIDER_PUBLIC_KEY) throw new Error("BILL_PROVIDER_PUBLIC_KEY required");
if (!process.env.MPP_SECRET_KEY) throw new Error("MPP_SECRET_KEY required");

const LLM_BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
const NETWORK = "stellar:testnet";

const llm = new OpenAI({ apiKey: process.env.LLM_API_KEY, baseURL: LLM_BASE_URL });
const agentKeypair = Keypair.fromSecret(process.env.AGENT_SECRET_KEY);

// --- Express App ---
const app = express();
app.use(cors());
app.use(express.json());

// --- Root info ---
app.get("/", (_req, res) => {
  res.json({
    service: "CareGuard AI Agent",
    version: "1.0.0",
    network: NETWORK,
    llm: `${LLM_BASE_URL} / ${LLM_MODEL}`,
    agentWallet: agentKeypair.publicKey(),
    careRecipient: "Rosa Garcia",
    caregiver: "Maria Garcia",
    paused: agentPaused,
    mode: "unified",
  });
});

// ============================================================
// PHARMACY PRICE API (was port 3001)
// ============================================================

const PRICING_DATABASE: Record<string, Array<{ pharmacy: string; id: string; price: number; distance: string }>> = {
  lisinopril: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 3.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 12.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 15.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 18.99, distance: "3.2 mi" },
  ],
  metformin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.00, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 11.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 13.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 16.79, distance: "3.2 mi" },
  ],
  atorvastatin: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 6.50, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 9.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 24.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 28.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 31.99, distance: "3.2 mi" },
  ],
  amlodipine: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 4.20, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 4.00, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 14.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 17.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 19.99, distance: "3.2 mi" },
  ],
  omeprazole: [
    { pharmacy: "Costco Pharmacy", id: "costco-001", price: 5.80, distance: "2.1 mi" },
    { pharmacy: "Walmart Pharmacy", id: "walmart-001", price: 8.50, distance: "1.8 mi" },
    { pharmacy: "CVS Pharmacy", id: "cvs-001", price: 22.99, distance: "0.5 mi" },
    { pharmacy: "Walgreens", id: "walgreens-001", price: 25.49, distance: "0.8 mi" },
    { pharmacy: "Rite Aid", id: "riteaid-001", price: 27.99, distance: "3.2 mi" },
  ],
};

app.get("/pharmacy/drugs", (_req, res) => {
  res.json({ drugs: Object.keys(PRICING_DATABASE) });
});

// x402 for pharmacy compare
applyX402Middleware(app, {
  "GET /pharmacy/compare": {
    accepts: { scheme: "exact", network: NETWORK, payTo: process.env.PHARMACY_1_PUBLIC_KEY!, price: "$0.002" },
    description: "Pharmacy price comparison — $0.002 USDC",
  },
});

app.get("/pharmacy/compare", (req, res) => {
  const drug = (req.query.drug as string || "").toLowerCase().trim();
  if (!drug) { res.status(400).json({ error: "Missing: drug" }); return; }
  const prices = PRICING_DATABASE[drug];
  if (!prices) { res.status(404).json({ error: `Drug "${drug}" not found` }); return; }
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0], most = sorted[sorted.length - 1];
  res.json({
    drug: drug.charAt(0).toUpperCase() + drug.slice(1),
    zipCode: req.query.zip || "90210",
    queryTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.002", payTo: process.env.PHARMACY_1_PUBLIC_KEY },
    prices: sorted.map(p => ({ pharmacyName: p.pharmacy, pharmacyId: p.id, price: p.price, distance: p.distance, inStock: true })),
    cheapest: { pharmacyName: cheapest.pharmacy, pharmacyId: cheapest.id, price: cheapest.price, distance: cheapest.distance },
    mostExpensive: { pharmacyName: most.pharmacy, pharmacyId: most.id, price: most.price },
    potentialSavings: +(most.price - cheapest.price).toFixed(2),
    savingsPercent: +((1 - cheapest.price / most.price) * 100).toFixed(1),
  });
});

// ============================================================
// BILL AUDIT API (was port 3002)
// ============================================================

const FAIR_MARKET_RATES: Record<string, { description: string; fairRate: number }> = {
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
  "J0170": { description: "Epinephrine", fairRate: 15 },
  "97110": { description: "Physical therapy", fairRate: 55 },
};

function runBillAudit(lineItems: any[]) {
  const results: any[] = [];
  let totalCharged = 0, totalCorrect = 0, errorCount = 0;
  const seenCodes: Record<string, number> = {};
  for (const item of lineItems) {
    totalCharged += item.chargedAmount;
    const fair = FAIR_MARKET_RATES[item.cptCode];
    const fairAmt = fair ? fair.fairRate * item.quantity : null;
    seenCodes[item.cptCode] = (seenCodes[item.cptCode] || 0) + 1;
    if (seenCodes[item.cptCode] > 1 && !["96372", "97110"].includes(item.cptCode)) {
      errorCount++;
      results.push({ ...item, fairMarketRate: fairAmt, status: "duplicate", errorDescription: `Duplicate CPT ${item.cptCode}`, suggestedAmount: 0 });
      continue;
    }
    if (fairAmt && item.chargedAmount > fairAmt * 1.5) {
      errorCount++;
      const suggested = +(fairAmt * 1.2).toFixed(2);
      totalCorrect += suggested;
      results.push({ ...item, fairMarketRate: fairAmt, status: item.chargedAmount > fairAmt * 3 ? "upcoded" : "overcharged", errorDescription: `Charged $${item.chargedAmount} — fair rate $${fairAmt}. Overcharged $${(item.chargedAmount - fairAmt).toFixed(2)}`, suggestedAmount: suggested });
      continue;
    }
    const suggested = fairAmt ? Math.min(item.chargedAmount, +(fairAmt * 1.2).toFixed(2)) : item.chargedAmount;
    totalCorrect += suggested;
    results.push({ ...item, fairMarketRate: fairAmt, status: "valid", errorDescription: null, suggestedAmount: suggested });
  }
  const totalOvercharge = +(totalCharged - totalCorrect).toFixed(2);
  return {
    auditTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.01", payTo: process.env.BILL_PROVIDER_PUBLIC_KEY },
    totalCharged: +totalCharged.toFixed(2), totalCorrect: +totalCorrect.toFixed(2),
    totalOvercharge, savingsPercent: totalCharged > 0 ? +((totalOvercharge / totalCharged) * 100).toFixed(1) : 0,
    errorCount, lineItems: results,
    recommendation: errorCount === 0 ? "No errors detected." : `Found ${errorCount} errors totaling $${totalOvercharge} in overcharges (${((totalOvercharge / totalCharged) * 100).toFixed(1)}% of total bill). Strongly recommend filing a formal dispute.`,
  };
}

app.get("/bill/sample", (_req, res) => {
  res.json({
    patientName: "Rosa Garcia", facilityName: "General Hospital", dateOfService: "2026-03-15",
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

// x402 for bill audit
applyX402Middleware(app, {
  "POST /bill/audit": {
    accepts: { scheme: "exact", network: NETWORK, payTo: process.env.BILL_PROVIDER_PUBLIC_KEY!, price: "$0.01" },
    description: "Bill audit — $0.01 USDC",
  },
});

app.post("/bill/audit", (req, res) => {
  const { lineItems } = req.body;
  if (!lineItems?.length) { res.status(400).json({ error: "Missing lineItems" }); return; }
  res.json(runBillAudit(lineItems));
});

// ============================================================
// DRUG INTERACTION API (was port 3003)
// ============================================================

const INTERACTIONS = [
  { drugs: ["lisinopril", "potassium"] as [string, string], severity: "severe" as const, description: "ACE inhibitors + potassium = hyperkalemia risk", recommendation: "Monitor potassium levels" },
  { drugs: ["metformin", "alcohol"] as [string, string], severity: "severe" as const, description: "Alcohol + metformin = lactic acidosis risk", recommendation: "Limit alcohol" },
  { drugs: ["atorvastatin", "grapefruit"] as [string, string], severity: "moderate" as const, description: "Grapefruit increases atorvastatin levels", recommendation: "Avoid grapefruit juice" },
  { drugs: ["lisinopril", "ibuprofen"] as [string, string], severity: "moderate" as const, description: "NSAIDs reduce lisinopril effectiveness", recommendation: "Use acetaminophen instead" },
  { drugs: ["amlodipine", "atorvastatin"] as [string, string], severity: "mild" as const, description: "Amlodipine slightly increases atorvastatin levels", recommendation: "Safe at standard doses" },
  { drugs: ["metformin", "atorvastatin"] as [string, string], severity: "mild" as const, description: "Statins may slightly increase blood sugar", recommendation: "Monitor blood sugar" },
  { drugs: ["omeprazole", "metformin"] as [string, string], severity: "mild" as const, description: "Long-term omeprazole may reduce B12 absorption", recommendation: "Monitor B12" },
  { drugs: ["lisinopril", "amlodipine"] as [string, string], severity: "mild" as const, description: "Common BP combo, generally safe", recommendation: "Monitor for low BP" },
];

// x402 for drug interactions
applyX402Middleware(app, {
  "GET /drug/interactions": {
    accepts: { scheme: "exact", network: NETWORK, payTo: process.env.PHARMACY_2_PUBLIC_KEY || process.env.PHARMACY_1_PUBLIC_KEY!, price: "$0.001" },
    description: "Drug interaction check — $0.001 USDC",
  },
});

app.get("/drug/interactions", (req, res) => {
  const medsParam = req.query.meds as string;
  if (!medsParam) { res.status(400).json({ error: "Missing: meds" }); return; }
  const medications = medsParam.split(",").map(m => m.trim()).filter(Boolean);
  if (medications.length < 2) { res.status(400).json({ error: "Need 2+ medications" }); return; }
  const meds = medications.map(m => m.toLowerCase());
  const found: any[] = [];
  for (let i = 0; i < meds.length; i++) {
    for (let j = i + 1; j < meds.length; j++) {
      for (const ix of INTERACTIONS) {
        if ((meds[i] === ix.drugs[0] && meds[j] === ix.drugs[1]) || (meds[i] === ix.drugs[1] && meds[j] === ix.drugs[0])) {
          found.push({ drug1: medications[i], drug2: medications[j], severity: ix.severity, description: ix.description, recommendation: ix.recommendation });
        }
      }
    }
  }
  const severe = found.filter(f => f.severity === "severe").length;
  const moderate = found.filter(f => f.severity === "moderate").length;
  res.json({
    checkTimestamp: new Date().toISOString(),
    protocol: { name: "x402", network: NETWORK, price: "$0.001" },
    medications, interactionCount: found.length, severeCount: severe, moderateCount: moderate,
    mildCount: found.length - severe - moderate,
    interactions: found,
    overallRisk: severe > 0 ? "high" : moderate > 0 ? "moderate" : found.length > 0 ? "low" : "none",
    summary: found.length === 0 ? "No known interactions found." : `Found ${found.length} interaction(s): ${severe} severe, ${moderate} moderate, ${found.length - severe - moderate} mild.`,
  });
});

// ============================================================
// MPP PHARMACY PAYMENT (was port 3005)
// ============================================================

const DATA_DIR = new URL("./data", import.meta.url).pathname;
const ORDERS_FILE = `${DATA_DIR}/orders.json`;
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function loadOrders(): any[] { if (!existsSync(ORDERS_FILE)) return []; return JSON.parse(readFileSync(ORDERS_FILE, "utf-8")); }
function saveOrder(order: any) { const orders = loadOrders(); orders.push(order); writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2)); }

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [stellar.charge({ recipient: process.env.PHARMACY_1_PUBLIC_KEY!, currency: USDC_SAC_TESTNET, network: NETWORK, store: Store.memory() })],
});

app.get("/pharmacy/orders", (_req, res) => { res.json({ orders: loadOrders() }); });

app.post("/pharmacy/order", async (req, res) => {
  const { drug, pharmacy, amount } = req.body;
  if (!drug || !pharmacy || !amount) { res.status(400).json({ error: "Missing: drug, pharmacy, amount" }); return; }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) { for (const e of value) headers.append(key, e); } else { headers.set(key, value); }
  }
  const webReq = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers });
  const result = await mppx.charge({ amount: parseFloat(amount).toFixed(2), description: `Medication: ${drug} from ${pharmacy}` })(webReq);
  if (result.status === 402) {
    result.challenge.headers.forEach((v: string, k: string) => res.setHeader(k, v));
    res.status(402).send(await result.challenge.text()); return;
  }
  const order = { id: `order-${Date.now()}`, drug, pharmacy, amount: parseFloat(amount), status: "confirmed", timestamp: new Date().toISOString(), network: NETWORK, protocol: "MPP Charge" };
  saveOrder(order);
  const response = result.withReceipt(Response.json({ success: true, order, message: `Payment settled. ${drug} from ${pharmacy} confirmed.` }));
  response.headers.forEach((v: string, k: string) => res.setHeader(k, v));
  res.status(response.status).json(await response.json());
});

// ============================================================
// AI AGENT
// ============================================================

let agentPaused = false;

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

const LLM_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOL_DEFINITIONS.map(t => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: { ...t.input_schema, additionalProperties: false } },
}));

async function executeTool(name: string, input: any): Promise<any> {
  switch (name) {
    case "compare_pharmacy_prices": return await comparePharmacyPrices(input.drug_name, input.zip_code);
    case "audit_medical_bill": { const items = typeof input.line_items_json === "string" ? JSON.parse(input.line_items_json) : (input.line_items || input.line_items_json); return await auditBill(items); }
    case "fetch_rosa_bill": return await fetchRosaBill();
    case "fetch_and_audit_bill": return await fetchAndAuditBill();
    case "check_drug_interactions": return await checkDrugInteractions(input.medications);
    case "pay_for_medication": return await payForMedication(input.pharmacy_id, input.pharmacy_name, input.drug_name, parseFloat(input.amount));
    case "pay_bill": return await payBill(input.provider_id, input.provider_name, input.description, parseFloat(input.amount));
    case "check_spending_policy": return checkSpendingPolicy(parseFloat(input.amount), input.category);
    case "get_spending_summary": return getSpendingSummary();
    default: return { error: `Unknown tool: ${name}` };
  }
}

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
      response = await llm.chat.completions.create({ model: LLM_MODEL, max_tokens: 4096, tools: LLM_TOOLS, messages });
    } catch (err: any) {
      if (toolCalls.length > 0 && !finalResponse) {
        finalResponse = toolCalls.map(tc => {
          if (tc.result?.error) return `${tc.tool}: ${tc.result.error}`;
          if (tc.tool === "compare_pharmacy_prices" && tc.result?.cheapest) return `${tc.result.drug}: $${tc.result.cheapest.price} at ${tc.result.cheapest.pharmacyName} (save $${tc.result.potentialSavings}/mo)`;
          if (tc.tool === "fetch_and_audit_bill" && tc.result?.totalOvercharge) return `Bill audit: $${tc.result.totalOvercharge} overcharges (${tc.result.errorCount} errors)`;
          if (tc.tool === "check_drug_interactions" && tc.result?.summary) return tc.result.summary;
          if (tc.tool === "pay_for_medication" && tc.result?.success) return `Paid $${tc.result.transaction.amount} for ${tc.result.transaction.description}`;
          return `${tc.tool}: completed`;
        }).join("\n");
      } else if (!finalResponse) finalResponse = `LLM error: ${err.message}`;
      break;
    }

    const choice = response.choices[0];
    if (!choice) break;
    messages.push(choice.message);
    if (choice.message.content) finalResponse = choice.message.content;
    if (!choice.message.tool_calls?.length) break;

    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      let args: any;
      try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
      console.log(`  🔧 ${tc.function.name}`);
      let result: any;
      try { result = await executeTool(tc.function.name, args); toolCalls.push({ tool: tc.function.name, input: args, result }); }
      catch (err: any) { result = { error: err.message }; toolCalls.push({ tool: tc.function.name, input: args, result }); }
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    if (choice.finish_reason === "stop") break;
  }

  return { response: finalResponse, toolCalls, spending: getSpendingSummary() };
}

// Agent endpoints
app.get("/agent/status", (_req, res) => { res.json({ paused: agentPaused }); });
app.post("/agent/pause", (_req, res) => { agentPaused = true; res.json({ paused: true }); });
app.post("/agent/resume", (_req, res) => { agentPaused = false; res.json({ paused: false }); });
app.get("/agent/spending", (_req, res) => { res.json(getSpendingSummary()); });
app.get("/agent/transactions", (_req, res) => { res.json(getSpendingTracker()); });
app.post("/agent/policy", (req, res) => { setSpendingPolicy(req.body); res.json({ success: true, policy: req.body }); });
app.post("/agent/reset", (_req, res) => { resetSpendingTracker(); res.json({ success: true }); });

app.post("/agent/run", async (req, res) => {
  if (!req.body?.task) { res.status(400).json({ error: "Missing task" }); return; }
  if (agentPaused) { res.status(409).json({ error: "Agent is paused", paused: true }); return; }
  console.log(`\n🤖 Task: "${req.body.task.slice(0, 80)}..."`);
  try {
    const result = await runAgent(req.body.task);
    console.log(`  ✅ ${result.toolCalls.length} tool calls`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// START
// ============================================================

const horizonServer = new Horizon.Server("https://horizon-testnet.stellar.org");

app.listen(PORT, async () => {
  console.log(`\n🏥 CareGuard Unified Server on http://localhost:${PORT}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   LLM: ${LLM_MODEL}`);
  console.log(`   Wallet: ${agentKeypair.publicKey()}`);
  try {
    const acc = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdc = acc.balances.find((b: any) => b.asset_code === "USDC");
    console.log(`   USDC: ${usdc?.balance || "0"}`);
  } catch { console.log("   USDC: unable to check"); }
  console.log(`   Ready.\n`);
});
