/**
 * CareGuard Agent Tools — Real payment integrations on Stellar testnet
 *
 * x402 client: Signs Soroban auth entries, pays USDC per API query via OZ facilitator
 * MPP client: Signs Soroban transfers, pays pharmacies via MPP charge mode
 * Stellar USDC: Direct USDC transfers for bill payments via Horizon
 * Spending policy: Persisted to file, enforced before every payment
 */

import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { Keypair, Networks, TransactionBuilder, Operation, Asset, Horizon } from "@stellar/stellar-sdk";
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { createEd25519Signer, ExactStellarScheme } from "@x402/stellar";
import { Mppx } from "mppx/client";
import { stellar as stellarCharge } from "@stellar/mpp/charge/client";
import type { SpendingPolicy, Transaction } from "../shared/types.ts";
export { SPENDING_TIMEZONE, getLocalDateStr } from "./tz.ts";

// Environment
const AGENT_SECRET_KEY = process.env.AGENT_SECRET_KEY;
const PHARMACY_API = process.env.PHARMACY_API_URL || "http://localhost:3001";
const BILL_AUDIT_API = process.env.BILL_AUDIT_API_URL || "http://localhost:3002";
const DRUG_INTERACTION_API = process.env.DRUG_INTERACTION_API_URL || "http://localhost:3003";
const PHARMACY_PAYMENT_API = process.env.PHARMACY_PAYMENT_API_URL || "http://localhost:3005";
const USDC_ISSUER = process.env.USDC_ISSUER || "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const X402_SETTLEMENT_GRACE_MS = 5 * 60 * 1000;

if (!AGENT_SECRET_KEY) throw new Error("AGENT_SECRET_KEY required in .env");

const agentKeypair = Keypair.fromSecret(AGENT_SECRET_KEY);
const horizonServer = new Horizon.Server(HORIZON_URL);

// Helper: extract real Stellar tx hash from x402 PAYMENT-RESPONSE header
function extractX402TxHash(response: Response): string | undefined {
  const header = response.headers.get("PAYMENT-RESPONSE") || response.headers.get("payment-response") || response.headers.get("X-PAYMENT-RESPONSE");
  if (!header) return undefined;
  try {
    const decoded = decodePaymentResponseHeader(header);
    return decoded.transaction || undefined;
  } catch {
    // If decode fails, the header itself might be a raw hash
    return header.length === 64 ? header : undefined;
  }
}

// --- x402 Client: Auto-handles 402 Payment Required for API queries ---
const signer = createEd25519Signer(AGENT_SECRET_KEY, "stellar:testnet");
const x402ClientInstance = new x402Client().register("stellar:testnet", new ExactStellarScheme(signer));
const x402Fetch = wrapFetchWithPayment(fetch, x402ClientInstance);

// --- MPP Client: Auto-handles 402 for medication order payments ---
// Track the latest MPP tx hash from progress events
let lastMppTxHash: string | undefined;

const mppClient = Mppx.create({
  methods: [
    stellarCharge({
      keypair: agentKeypair,
      mode: "pull",
      onProgress: (event) => {
        console.log(`  [MPP] ${event.type}${("hash" in event) ? `: ${(event as any).hash}` : ""}`);
        if (event.type === "paid" && "hash" in event) {
          lastMppTxHash = (event as any).hash;
        }
      },
    }),
  ],
  polyfill: false,
});

// --- Persistent spending tracker ---
const DATA_DIR = new URL("../data", import.meta.url).pathname;
const SPENDING_FILE = `${DATA_DIR}/spending.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

interface SpendingTracker {
  medications: number;
  bills: number;
  serviceFees: number;
  pendingServiceFees: number;
  transactions: Transaction[];
}

function loadSpending(): SpendingTracker {
  if (!existsSync(SPENDING_FILE)) return { medications: 0, bills: 0, serviceFees: 0, pendingServiceFees: 0, transactions: [] };
  const parsed = JSON.parse(readFileSync(SPENDING_FILE, "utf-8"));
  return {
    medications: parsed.medications || 0,
    bills: parsed.bills || 0,
    serviceFees: parsed.serviceFees || 0,
    pendingServiceFees: parsed.pendingServiceFees || 0,
    transactions: parsed.transactions || [],
  };
}

export function saveSpending(data: SpendingTracker) {
  writeFileSync(SPENDING_FILE, JSON.stringify(data, null, 2));
}

let spendingTracker = loadSpending();

const POLICY_FILE = `${DATA_DIR}/policy.json`;

const MAX_PAYMENT = 1000;
const MAX_ERROR_LENGTH = 500;

function truncateError(message: string): string {
  return message.replace(/<[^>]*>/g, "").slice(0, MAX_ERROR_LENGTH);
}

const DEFAULT_POLICY: SpendingPolicy = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
};

function loadPolicy(): SpendingPolicy {
  if (!existsSync(POLICY_FILE)) return { ...DEFAULT_POLICY };
  try { return JSON.parse(readFileSync(POLICY_FILE, "utf-8")); }
  catch { return { ...DEFAULT_POLICY }; }
}

function savePolicy(policy: SpendingPolicy) {
  writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2));
}

let currentPolicy: SpendingPolicy = loadPolicy();

export function setSpendingPolicy(policy: SpendingPolicy) {
  currentPolicy = policy;
  savePolicy(policy);
}
export function getSpendingTracker() { return { ...spendingTracker, policy: currentPolicy }; }
export function resetSpendingTracker() {
  spendingTracker = { medications: 0, bills: 0, serviceFees: 0, pendingServiceFees: 0, transactions: [] };
  saveSpending(spendingTracker);
}

function reserveX402ServiceFee(amount: number, description: string, recipient: string, stellarTxHash?: string) {
  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: "service_fee",
    description,
    amount,
    recipient,
    stellarTxHash,
    status: "pending_settlement",
    category: "service_fees",
  };

  spendingTracker.pendingServiceFees += amount;
  spendingTracker.transactions.push(tx);
  saveSpending(spendingTracker);
  return tx;
}

export async function reconcilePendingServiceFees(now = Date.now()) {
  let updated = false;

  for (const tx of spendingTracker.transactions) {
    if (tx.type !== "service_fee" || tx.status !== "pending_settlement") continue;
    if (!tx.stellarTxHash) continue;

    try {
      await horizonServer.transactions().transaction(tx.stellarTxHash).call();
      tx.status = "completed";
      spendingTracker.pendingServiceFees = Math.max(0, spendingTracker.pendingServiceFees - tx.amount);
      spendingTracker.serviceFees += tx.amount;
      updated = true;
      continue;
    } catch (err: any) {
      const status = err?.response?.status || err?.status;
      const isNotFound = status === 404;
      const isPastGrace = now - new Date(tx.timestamp).getTime() >= X402_SETTLEMENT_GRACE_MS;

      if (isNotFound && isPastGrace) {
        tx.status = "failed";
        spendingTracker.pendingServiceFees = Math.max(0, spendingTracker.pendingServiceFees - tx.amount);
        updated = true;
      }
    }
  }

  if (updated) saveSpending(spendingTracker);
  return {
    pendingServiceFees: spendingTracker.pendingServiceFees,
    settledServiceFees: spendingTracker.serviceFees,
    transactionsUpdated: updated,
  };
}

// --- Tool: Compare pharmacy prices (pays via x402) ---
export async function comparePharmacyPrices(drugName: string, zipCode: string = "90210") {
  const url = `${PHARMACY_API}/pharmacy/compare?drug=${encodeURIComponent(drugName)}&zip=${encodeURIComponent(zipCode)}`;
  console.log(`  [x402] Paying for pharmacy price query: ${drugName}`);

  const response = await x402Fetch(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pharmacy API error (${response.status}): ${truncateError(error)}`);
  }

  const data = await response.json();

  // Reserve first; settlement is confirmed later by reconciliation against Horizon.
  reserveX402ServiceFee(
    0.002,
    `x402 query: pharmacy prices for ${drugName}`,
    data.protocol?.payTo || "pharmacy-price-api",
    extractX402TxHash(response)
  );

  return data;
}

// --- Tool: Fetch Rosa's hospital bill (free endpoint, no x402 payment) ---
export async function fetchRosaBill() {
  console.log(`  [fetch] Getting Rosa's hospital bill from ${BILL_AUDIT_API}/bill/sample`);

  const response = await fetch(`${BILL_AUDIT_API}/bill/sample`);

  if (!response.ok) {
    throw new Error(`Failed to fetch bill (${response.status}): service may be starting up. Try again in a moment.`);
  }

  return await response.json();
}

// --- Tool: Fetch Rosa's bill AND audit it in one step (pays via x402) ---
export async function fetchAndAuditBill() {
  console.log(`  [fetch+audit] Getting Rosa's bill and auditing it`);

  // Step 1: Fetch the bill (free)
  const billResponse = await fetch(`${BILL_AUDIT_API}/bill/sample`);
  if (!billResponse.ok) {
    throw new Error(`Failed to fetch bill (${billResponse.status}): service may be starting up.`);
  }
  const bill = await billResponse.json();

  // Step 2: Audit it (pays via x402)
  return await auditBill(bill.lineItems);
}

// --- Tool: Audit a medical bill (pays via x402) ---
export async function auditBill(lineItems: Array<{ description: string; cptCode: string; quantity: number; chargedAmount: number }>) {
  console.log(`  [x402] Paying for bill audit (${lineItems.length} line items)`);

  let response: Response;
  try {
    response = await x402Fetch(`${BILL_AUDIT_API}/bill/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineItems }),
    });
  } catch (err: any) {
    const baseUrl = BILL_AUDIT_API;
    const docsHint = "See docs/setup/services.md for local service setup.";
    const message = typeof err?.message === "string" ? err.message : "Unknown network error";
    const code = err?.cause?.code || err?.code;

    if (code === "ECONNREFUSED") {
      throw new Error(
        `Bill Audit API connection refused (ECONNREFUSED). This is usually a config or startup issue. ` +
        `Ensure BILL_AUDIT_API_URL points to a running service (currently ${baseUrl}). ${docsHint}`
      );
    }

    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_SOCKET") {
      throw new Error(
        `Bill Audit API request timed out. This is often transient (network hiccup or cold start). ` +
        `Try again; if it persists, verify the service at ${baseUrl} is reachable. ${docsHint}`
      );
    }

    if (code === "ENOTFOUND") {
      throw new Error(
        `Bill Audit API hostname not found (ENOTFOUND). Check BILL_AUDIT_API_URL (currently ${baseUrl}). ${docsHint}`
      );
    }

    throw new Error(
      `Bill Audit API unreachable. ${message}. Verify the service is reachable at ${baseUrl}. ${docsHint}`
    );
  }

  if (!response.ok) {
    const error = await response.text();
    const bodyPreview = truncateError(error);

    if (response.status >= 500) {
      throw new Error(
        `Bill Audit API is up but failing (${response.status}). This indicates a downstream/service bug or outage. ` +
        `Try again later or check the Bill Audit service logs. Details: ${bodyPreview}`
      );
    }

    if (response.status >= 400 && response.status < 500) {
      throw new Error(
        `Bill Audit API rejected the request (${response.status}). This is likely a caller/input issue. ` +
        `Verify the payload schema and required env vars. Details: ${bodyPreview}`
      );
    }

    throw new Error(`Bill Audit API error (${response.status}): ${bodyPreview}`);
  }

  const data = await response.json();

  reserveX402ServiceFee(
    0.01,
    "x402 query: medical bill audit",
    data.protocol?.payTo || "bill-audit-api",
    extractX402TxHash(response)
  );

  return data;
}

// --- Tool: Check drug interactions (pays via x402) ---
export async function checkDrugInteractions(medications: string[]) {
  const medsParam = medications.join(",");
  console.log(`  [x402] Paying for drug interaction check: ${medsParam}`);

  const response = await x402Fetch(`${DRUG_INTERACTION_API}/drug/interactions?meds=${encodeURIComponent(medsParam)}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Drug Interaction API error (${response.status}): ${truncateError(error)}`);
  }

  const data = await response.json();

  reserveX402ServiceFee(
    0.001,
    `x402 query: drug interactions for ${medications.join(", ")}`,
    data.protocol?.payTo || "drug-interaction-api",
    extractX402TxHash(response)
  );

  return data;
}

// --- Tool: Check spending policy ---
export function checkSpendingPolicy(amount: number, category: "medications" | "bills") {
  const budget = category === "medications" ? currentPolicy.medicationMonthlyBudget : currentPolicy.billMonthlyBudget;
  const currentSpending = category === "medications" ? spendingTracker.medications : spendingTracker.bills;
  const remaining = budget - currentSpending;

  if (amount > remaining) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} exceeds ${category} monthly budget. Budget: $${budget}, spent: $${currentSpending.toFixed(2)}, remaining: $${remaining.toFixed(2)}`,
      requiresApproval: false, currentSpending, budgetRemaining: remaining,
    };
  }

  const today = getLocalDateStr(SPENDING_TIMEZONE);
  const totalToday = spendingTracker.transactions
    .filter(t => getLocalDateStr(SPENDING_TIMEZONE, new Date(t.timestamp)) === today && t.category === category)
    .reduce((sum, t) => sum + t.amount, 0);

  if (totalToday + amount > currentPolicy.dailyLimit) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} would exceed daily limit of $${currentPolicy.dailyLimit}. Already spent today: $${totalToday.toFixed(2)}`,
      requiresApproval: false, currentSpending, budgetRemaining: remaining,
    };
  }

  return { allowed: true, requiresApproval: amount > currentPolicy.approvalThreshold, currentSpending, budgetRemaining: remaining - amount };
}

// --- Tool: Pay for medication via MPP Charge (real Stellar payment) ---
export async function payForMedication(pharmacyId: string, pharmacyName: string, drugName: string, amount: number, skipApproval: boolean = false) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return { success: false, error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.` };
  }
  const policyCheck = checkSpendingPolicy(amount, "medications");
  if (!policyCheck.allowed) return { success: false, error: `BLOCKED BY SPENDING POLICY: ${policyCheck.reason}` };
  if (policyCheck.requiresApproval && !skipApproval) {
    const tx: Transaction = {
      id: `tx-${Date.now()}`, timestamp: new Date().toISOString(), type: "medication",
      description: `${drugName} from ${pharmacyName}`, amount, recipient: pharmacyId,
      status: "pending", category: "medications",
    };
    spendingTracker.transactions.push(tx);
    saveSpending(spendingTracker);
    return { success: false, error: `REQUIRES CAREGIVER APPROVAL: $${amount.toFixed(2)} exceeds the $${currentPolicy.approvalThreshold} approval threshold.`, transaction: tx };
  }

  // Execute real MPP charge payment to pharmacy
  console.log(`  [MPP] Paying ${pharmacyName} $${amount} for ${drugName}`);

  let stellarTxHash: string | undefined;
  let mppOrderId: string | undefined;
  lastMppTxHash = undefined; // reset before this payment

  try {
    const response = await mppClient.fetch(`${PHARMACY_PAYMENT_API}/pharmacy/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drug: drugName, pharmacy: pharmacyName, amount }),
    });

    const data = await response.json();
    if (data.success) {
      // Try to get tx hash from: 1) MPP progress event, 2) Payment-Receipt header
      stellarTxHash = lastMppTxHash;
      if (!stellarTxHash) {
        const receiptHeader = response.headers.get("Payment-Receipt") || response.headers.get("payment-receipt");
        if (receiptHeader) {
          try {
            const receipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString());
            stellarTxHash = receipt.reference || receipt.hash || receipt.transaction;
          } catch {
            stellarTxHash = receiptHeader;
          }
        }
      }
      // data.order.id is an MPP order identifier — kept separate from stellarTxHash
      mppOrderId = data.order?.id;
    } else {
      throw new Error(data.error || "MPP payment failed");
    }
  } catch (err: any) {
    return { success: false, error: `MPP payment failed: ${err.message}` };
  }

  const tx: Transaction = {
    id: `tx-${Date.now()}`, timestamp: new Date().toISOString(), type: "medication",
    description: `${drugName} from ${pharmacyName} [MPP Charge]`, amount, recipient: pharmacyId,
    stellarTxHash, mppOrderId, status: "completed", category: "medications",
  };

  spendingTracker.medications += amount;
  spendingTracker.transactions.push(tx);
  saveSpending(spendingTracker);

  return { success: true, transaction: tx };
}

// --- Tool: Pay a medical bill via real Stellar USDC transfer ---
export async function payBill(providerId: string, providerName: string, description: string, amount: number, skipApproval: boolean = false) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return { success: false, error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.` };
  }
  const policyCheck = checkSpendingPolicy(amount, "bills");
  if (!policyCheck.allowed) return { success: false, error: `BLOCKED BY SPENDING POLICY: ${policyCheck.reason}` };
  if (policyCheck.requiresApproval && !skipApproval) {
    const tx: Transaction = {
      id: `tx-${Date.now()}`, timestamp: new Date().toISOString(), type: "bill",
      description: `${description} — ${providerName}`, amount, recipient: providerId,
      status: "pending", category: "bills",
    };
    spendingTracker.transactions.push(tx);
    saveSpending(spendingTracker);
    return { success: false, error: `REQUIRES CAREGIVER APPROVAL: $${amount.toFixed(2)} exceeds the $${currentPolicy.approvalThreshold} approval threshold.`, transaction: tx };
  }

  // Execute real Stellar USDC transfer
  const recipientKey = process.env.BILL_PROVIDER_PUBLIC_KEY;
  if (!recipientKey) return { success: false, error: "BILL_PROVIDER_PUBLIC_KEY not configured" };

  console.log(`  [Stellar] Transferring $${amount} USDC to ${providerName} (${recipientKey.slice(0, 8)}...)`);

  let stellarTxHash: string | undefined;

  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcAsset = new Asset("USDC", USDC_ISSUER);

    const stellarTx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: recipientKey,
          asset: usdcAsset,
          amount: amount.toFixed(7),
        })
      )
      .setTimeout(30)
      .build();

    stellarTx.sign(agentKeypair);
    const result = await horizonServer.submitTransaction(stellarTx);
    stellarTxHash = (result as any).hash;
    console.log(`  [Stellar] TX confirmed: ${stellarTxHash}`);
  } catch (err: any) {
    const errorDetail = err?.response?.data?.extras?.result_codes || err.message;
    return { success: false, error: `Stellar USDC transfer failed: ${JSON.stringify(errorDetail)}` };
  }

  const tx: Transaction = {
    id: `tx-${Date.now()}`, timestamp: new Date().toISOString(), type: "bill",
    description: `${description} — ${providerName} [Stellar USDC]`, amount, recipient: providerId,
    stellarTxHash, status: "completed", category: "bills",
  };

  spendingTracker.bills += amount;
  spendingTracker.transactions.push(tx);
  saveSpending(spendingTracker);

  return { success: true, transaction: tx };
}

// --- Tool: Get spending summary ---
export function getSpendingSummary() {
  const total = spendingTracker.medications + spendingTracker.bills + spendingTracker.serviceFees + spendingTracker.pendingServiceFees;
  return {
    policy: currentPolicy,
    spending: {
      medications: +spendingTracker.medications.toFixed(2),
      bills: +spendingTracker.bills.toFixed(2),
      serviceFees: +spendingTracker.serviceFees.toFixed(4),
      pendingServiceFees: +spendingTracker.pendingServiceFees.toFixed(4),
      total: +total.toFixed(2),
    },
    budgetRemaining: {
      medications: +(currentPolicy.medicationMonthlyBudget - spendingTracker.medications).toFixed(2),
      bills: +(currentPolicy.billMonthlyBudget - spendingTracker.bills).toFixed(2),
    },
    transactionCount: spendingTracker.transactions.length,
    recentTransactions: spendingTracker.transactions.slice(-5),
  };
}

// Claude API tool definitions
export const TOOL_DEFINITIONS = [
  {
    name: "compare_pharmacy_prices",
    description: "Compare medication prices across multiple pharmacies. Pays $0.002 USDC per query via x402 on Stellar. Returns prices sorted cheapest to most expensive, with potential savings.",
    input_schema: {
      type: "object" as const,
      properties: {
        drug_name: { type: "string", description: "Name of the medication (e.g., Lisinopril, Metformin)" },
        zip_code: { type: "string", description: "ZIP code for pharmacy location (default: 90210)" },
      },
      required: ["drug_name"],
    },
  },
  {
    name: "audit_medical_bill",
    description: "Audit a medical bill for errors (duplicates, upcoding, overcharges). 80% of medical bills contain errors. Pays $0.01 USDC per audit via x402 on Stellar. Pass line_items as a JSON string array of objects with fields: description, cptCode, quantity, chargedAmount.",
    input_schema: {
      type: "object" as const,
      properties: {
        line_items_json: {
          type: "string",
          description: "JSON string of line items array. Each item: {\"description\":\"...\",\"cptCode\":\"...\",\"quantity\":1,\"chargedAmount\":100}",
        },
      },
      required: ["line_items_json"],
    },
  },
  {
    name: "check_drug_interactions",
    description: "Check for drug-drug interactions. Pays $0.001 USDC per check via x402 on Stellar. Returns severity levels and clinical recommendations.",
    input_schema: {
      type: "object" as const,
      properties: {
        medications: { type: "array", items: { type: "string" }, description: "List of medication names" },
      },
      required: ["medications"],
    },
  },
  {
    name: "pay_for_medication",
    description: "Pay a pharmacy for a medication order via MPP Charge on Stellar (real USDC payment). Subject to spending policy limits.",
    input_schema: {
      type: "object" as const,
      properties: {
        pharmacy_id: { type: "string" }, pharmacy_name: { type: "string" },
        drug_name: { type: "string" }, amount: { type: "number" },
      },
      required: ["pharmacy_id", "pharmacy_name", "drug_name", "amount"],
    },
  },
  {
    name: "pay_bill",
    description: "Pay a medical bill via direct Stellar USDC transfer. Subject to spending policy limits. If the bill has been audited and errors found, pay only the corrected amount.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider_id: { type: "string" }, provider_name: { type: "string" },
        description: { type: "string" }, amount: { type: "number" },
      },
      required: ["provider_id", "provider_name", "description", "amount"],
    },
  },
  {
    name: "check_spending_policy",
    description: "Check if a payment amount is within the caregiver-set spending policy limits before attempting payment.",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: { type: "number" }, category: { type: "string", enum: ["medications", "bills"] },
      },
      required: ["amount", "category"],
    },
  },
  {
    name: "fetch_rosa_bill",
    description: "Fetch Rosa Garcia's hospital bill from General Hospital. Returns the bill with line items including CPT codes and charged amounts.",
    input_schema: {
      type: "object" as const,
      properties: {
        _unused: { type: "string", description: "Not used. Pass empty string." },
      },
      required: [] as string[],
    },
  },
  {
    name: "fetch_and_audit_bill",
    description: "Fetch Rosa's hospital bill from General Hospital AND audit it for errors in one step. Pays $0.01 USDC via x402. Returns the audit results with errors found, overcharges, and corrected total. Use this instead of calling fetch_rosa_bill + audit_medical_bill separately.",
    input_schema: {
      type: "object" as const,
      properties: {
        _unused: { type: "string", description: "Not used. Pass empty string." },
      },
      required: [] as string[],
    },
  },
  {
    name: "get_spending_summary",
    description: "Get current spending summary: total spent, budget remaining per category, recent transactions with Stellar tx hashes.",
    input_schema: {
      type: "object" as const,
      properties: {
        _unused: { type: "string", description: "Not used. Pass empty string." },
      },
      required: [] as string[],
    },
  },
];
