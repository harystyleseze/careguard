/**
 * CareGuard Agent Tools — Real payment integrations on Stellar testnet
 *
 * x402 client: Signs Soroban auth entries, pays USDC per API query via OZ facilitator
 * MPP client: Signs Soroban transfers, pays pharmacies via MPP charge mode
 * Stellar USDC: Direct USDC transfers for bill payments via Horizon
 * Spending policy: Persisted to file, enforced before every payment.
 *   ⚠️  DO NOT COMMIT data/spending.json or data/orders.json — they contain
 *   live balances and transaction history. Add them to .gitignore and never
 *   include them in a PR. See data/README.md for details.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { logger } from '../shared/logger.ts';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  Horizon,
} from '@stellar/stellar-sdk';
import {
  wrapFetchWithPayment,
  x402Client,
  decodePaymentResponseHeader,
} from '@x402/fetch';
import { createEd25519Signer, ExactStellarScheme } from '@x402/stellar';
import { Mppx } from 'mppx/client';
import { stellar as stellarCharge } from '@stellar/mpp/charge/client';
import type { SpendingPolicy, Transaction } from '../shared/types.ts';
import { SPENDING_TIMEZONE, getLocalDateStr } from './tz.ts';
export { SPENDING_TIMEZONE, getLocalDateStr };
import { appendAuditEntry } from '../shared/audit-log.ts';
import {
  x402SettlementsTotal,
  paymentsUsdcTotal,
  stellarTxSubmittedTotal,
  policyBlocksTotal,
  agentSpendingUsd,
  agentTransactionsTotal,
} from '../shared/metrics.ts';

// Environment
const AGENT_SECRET_KEY = process.env.AGENT_SECRET_KEY;
const PHARMACY_API = process.env.PHARMACY_API_URL || 'http://localhost:3001';
const BILL_AUDIT_API =
  process.env.BILL_AUDIT_API_URL || 'http://localhost:3002';
const DRUG_INTERACTION_API =
  process.env.DRUG_INTERACTION_API_URL || 'http://localhost:3003';
const PHARMACY_PAYMENT_API =
  process.env.PHARMACY_PAYMENT_API_URL || 'http://localhost:3005';
const USDC_ISSUER =
  process.env.USDC_ISSUER ||
  'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

if (!AGENT_SECRET_KEY) throw new Error('AGENT_SECRET_KEY required in .env');

const agentKeypair = Keypair.fromSecret(AGENT_SECRET_KEY);
const horizonServer = new Horizon.Server(HORIZON_URL);

// Helper: extract real Stellar tx hash from x402 PAYMENT-RESPONSE header
function extractX402TxHash(response: Response): string | undefined {
  const header =
    response.headers.get('PAYMENT-RESPONSE') ||
    response.headers.get('payment-response') ||
    response.headers.get('X-PAYMENT-RESPONSE');
  if (!header) return undefined;
  try {
    const decoded = decodePaymentResponseHeader(header);
    return decoded.transaction || undefined;
  } catch {
    // If decode fails, the header itself might be a raw hash
    return header.length === 64 ? header : undefined;
  }
}

// Helper: submitTransaction with timeout and retry
async function submitTransactionWithRetry(
  server: Horizon.Server,
  tx: any,
  maxRetries = 2,
  timeoutMs = 35000,
): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await server.submitTransaction(tx, { timeout: timeoutMs });
      return result;
    } catch (err: any) {
      lastError = err;
      // Don't retry if the server responded with a transaction failure
      if (err?.response?.status) throw err;
      // Don't retry if the transaction expired
      const msg = err?.message ?? '';
      if (
        msg.includes('tx_bad_seq') ||
        msg.includes('tx_too_early') ||
        msg.includes('tx_too_late')
      )
        throw err;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 500;
        logger.warn(
          { attempt: attempt + 1, maxRetries, delay },
          '[Stellar] submitTransaction timeout, retrying',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// Helper: wait for a Stellar transaction to be confirmed on-chain
async function waitForStellarSettlement(
  txHash: string,
  maxRetries = 5,
  intervalMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await horizonServer.transactions().transaction(txHash).call();
      return true;
    } catch {
      if (i < maxRetries - 1)
        await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}

// --- x402 Client: Auto-handles 402 Payment Required for API queries ---
const signer = createEd25519Signer(AGENT_SECRET_KEY, 'stellar:testnet');
const x402ClientInstance = new x402Client().register(
  'stellar:testnet',
  new ExactStellarScheme(signer),
);
const x402Fetch = wrapFetchWithPayment(fetch, x402ClientInstance);

// --- MPP Client: Auto-handles 402 for medication order payments ---
// Track the latest MPP tx hash from progress events
let lastMppTxHash: string | undefined;

const mppClient = Mppx.create({
  methods: [
    stellarCharge({
      keypair: agentKeypair,
      mode: 'pull',
      onProgress: (event) => {
        logger.info(
          {
            type: event.type,
            hash: 'hash' in event ? (event as any).hash : undefined,
          },
          '[MPP] progress',
        );
        if (event.type === 'paid' && 'hash' in event) {
          lastMppTxHash = (event as any).hash;
        }
      },
    }),
  ],
  polyfill: false,
});

// --- Persistent spending tracker ---
const DATA_DIR = new URL('../data', import.meta.url).pathname;
const SPENDING_FILE = `${DATA_DIR}/spending.json`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

interface SpendingTracker {
  medications: number;
  bills: number;
  serviceFees: number;
  transactions: Transaction[];
}

function loadSpending(): SpendingTracker {
  if (!existsSync(SPENDING_FILE))
    return { medications: 0, bills: 0, serviceFees: 0, transactions: [] };
  return JSON.parse(readFileSync(SPENDING_FILE, 'utf-8'));
}

function saveSpending(data: SpendingTracker) {
  writeFileSync(SPENDING_FILE, JSON.stringify(data, null, 2));
}

let spendingTracker = loadSpending();

const POLICY_FILE = `${DATA_DIR}/policy.json`;

const MAX_PAYMENT = 1000;
const MAX_ERROR_LENGTH = 500;

function truncateError(message: string): string {
  return message.replace(/<[^>]*>/g, '').slice(0, MAX_ERROR_LENGTH);
}

const DEFAULT_POLICY: SpendingPolicy = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
};

function loadPolicy(): SpendingPolicy {
  if (!existsSync(POLICY_FILE)) return { ...DEFAULT_POLICY };
  try {
    return JSON.parse(readFileSync(POLICY_FILE, 'utf-8'));
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

function savePolicy(policy: SpendingPolicy) {
  writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2));
}

let currentPolicy: SpendingPolicy = loadPolicy();

export function setSpendingPolicy(policy: SpendingPolicy) {
  const previous = currentPolicy;
  currentPolicy = policy;
  savePolicy(policy);
  appendAuditEntry({
    event: 'policy.updated',
    actor: 'caregiver',
    details: {
      previous: { ...previous },
      current: { ...policy },
    },
  });
}
export function getSpendingTracker() {
  return { ...spendingTracker, policy: currentPolicy };
}
export function resetSpendingTracker() {
  const previousTotal =
    spendingTracker.medications +
    spendingTracker.bills +
    spendingTracker.serviceFees;
  spendingTracker = {
    medications: 0,
    bills: 0,
    serviceFees: 0,
    transactions: [],
  };
  saveSpending(spendingTracker);
  appendAuditEntry({
    event: 'spending.reset',
    actor: 'caregiver',
    details: { previousTotal: +previousTotal.toFixed(2) },
  });
}

// --- Tool: Compare pharmacy prices (pays via x402) ---
export async function comparePharmacyPrices(
  drugName: string,
  zipCode: string = '90210',
) {
  const url = `${PHARMACY_API}/pharmacy/compare?drug=${encodeURIComponent(drugName)}&zip=${encodeURIComponent(zipCode)}`;
  logger.info({ drug: drugName }, '[x402] paying for pharmacy price query');

  const response = await x402Fetch(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Pharmacy API error (${response.status}): ${truncateError(error)}`,
    );
  }

  const data = await response.json();

  // Extract real Stellar tx hash from x402 payment response header
  const txHash = extractX402TxHash(response);

  // Wait for on-chain settlement before recording the fee
  if (txHash) {
    const settled = await waitForStellarSettlement(txHash);
    if (!settled) {
      throw new Error(
        `x402 settlement not confirmed on-chain for tx ${txHash}`,
      );
    }
  }

  x402SettlementsTotal.inc();
  spendingTracker.serviceFees += 0.002;
  spendingTracker.transactions.push({
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'service_fee',
    description: `x402 query: pharmacy prices for ${drugName}`,
    amount: 0.002,
    recipient: data.protocol?.payTo || 'pharmacy-price-api',
    stellarTxHash: txHash,
    status: 'completed',
    category: 'service_fees',
  });
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: 'service_fees' },
    spendingTracker.serviceFees,
  );
  saveSpending(spendingTracker);

  return data;
}

// --- Tool: Fetch Rosa's hospital bill (free endpoint, no x402 payment) ---
export async function fetchRosaBill() {
  logger.info("[fetch] getting Rosa's hospital bill");

  const response = await fetch(`${BILL_AUDIT_API}/bill/sample`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch bill (${response.status}): service may be starting up. Try again in a moment.`,
    );
  }

  return await response.json();
}

// --- Tool: Fetch Rosa's bill AND audit it in one step (pays via x402) ---
export async function fetchAndAuditBill() {
  logger.info("[fetch+audit] getting Rosa's bill and auditing it");

  // Step 1: Fetch the bill (free)
  const billResponse = await fetch(`${BILL_AUDIT_API}/bill/sample`);
  if (!billResponse.ok) {
    throw new Error(
      `Failed to fetch bill (${billResponse.status}): service may be starting up.`,
    );
  }
  const bill = await billResponse.json();

  // Step 2: Audit it (pays via x402)
  return await auditBill(bill.lineItems);
}

// --- Tool: Audit a medical bill (pays via x402) ---
export async function auditBill(
  lineItems: Array<{
    description: string;
    cptCode: string;
    quantity: number;
    chargedAmount: number;
  }>,
) {
  logger.info(
    { lineItemCount: lineItems.length },
    '[x402] paying for bill audit',
  );

  let response: Response;
  try {
    response = await x402Fetch(`${BILL_AUDIT_API}/bill/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineItems }),
    });
  } catch (err: any) {
    const baseUrl = BILL_AUDIT_API;
    const docsHint = 'See docs/setup/services.md for local service setup.';
    const message =
      typeof err?.message === 'string' ? err.message : 'Unknown network error';
    const code = err?.cause?.code || err?.code;

    if (code === 'ECONNREFUSED') {
      throw new Error(
        `Bill Audit API connection refused (ECONNREFUSED). This is usually a config or startup issue. ` +
          `Ensure BILL_AUDIT_API_URL points to a running service (currently ${baseUrl}). ${docsHint}`,
      );
    }

    if (
      code === 'ETIMEDOUT' ||
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_SOCKET'
    ) {
      throw new Error(
        `Bill Audit API request timed out. This is often transient (network hiccup or cold start). ` +
          `Try again; if it persists, verify the service at ${baseUrl} is reachable. ${docsHint}`,
      );
    }

    if (code === 'ENOTFOUND') {
      throw new Error(
        `Bill Audit API hostname not found (ENOTFOUND). Check BILL_AUDIT_API_URL (currently ${baseUrl}). ${docsHint}`,
      );
    }

    throw new Error(
      `Bill Audit API unreachable. ${message}. Verify the service is reachable at ${baseUrl}. ${docsHint}`,
    );
  }

  if (!response.ok) {
    const error = await response.text();
    const bodyPreview = truncateError(error);

    if (response.status >= 500) {
      throw new Error(
        `Bill Audit API is up but failing (${response.status}). This indicates a downstream/service bug or outage. ` +
          `Try again later or check the Bill Audit service logs. Details: ${bodyPreview}`,
      );
    }

    if (response.status >= 400 && response.status < 500) {
      throw new Error(
        `Bill Audit API rejected the request (${response.status}). This is likely a caller/input issue. ` +
          `Verify the payload schema and required env vars. Details: ${bodyPreview}`,
      );
    }

    throw new Error(
      `Bill Audit API error (${response.status}): ${bodyPreview}`,
    );
  }

  const data = await response.json();

  const txHash = extractX402TxHash(response);

  // Wait for on-chain settlement before recording the fee
  if (txHash) {
    const settled = await waitForStellarSettlement(txHash);
    if (!settled) {
      throw new Error(
        `x402 settlement not confirmed on-chain for tx ${txHash}`,
      );
    }
  }

  x402SettlementsTotal.inc();
  spendingTracker.serviceFees += 0.01;
  spendingTracker.transactions.push({
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'service_fee',
    description: 'x402 query: medical bill audit',
    amount: 0.01,
    recipient: data.protocol?.payTo || 'bill-audit-api',
    stellarTxHash: txHash,
    status: 'completed',
    category: 'service_fees',
  });
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: 'service_fees' },
    spendingTracker.serviceFees,
  );
  saveSpending(spendingTracker);

  return data;
}

// --- Tool: Check drug interactions (pays via x402) ---
export async function checkDrugInteractions(medications: string[]) {
  const medsParam = medications.join(',');
  logger.info(
    { medicationCount: medications.length },
    '[x402] paying for drug interaction check',
  );

  const response = await x402Fetch(
    `${DRUG_INTERACTION_API}/drug/interactions?meds=${encodeURIComponent(medsParam)}`,
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Drug Interaction API error (${response.status}): ${truncateError(error)}`,
    );
  }

  const data = await response.json();

  const txHash = extractX402TxHash(response);

  // Wait for on-chain settlement before recording the fee
  if (txHash) {
    const settled = await waitForStellarSettlement(txHash);
    if (!settled) {
      throw new Error(
        `x402 settlement not confirmed on-chain for tx ${txHash}`,
      );
    }
  }

  x402SettlementsTotal.inc();
  spendingTracker.serviceFees += 0.001;
  spendingTracker.transactions.push({
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'service_fee',
    description: `x402 query: drug interactions for ${medications.join(', ')}`,
    amount: 0.001,
    recipient: data.protocol?.payTo || 'drug-interaction-api',
    stellarTxHash: txHash,
    status: 'completed',
    category: 'service_fees',
  });
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: 'service_fees' },
    spendingTracker.serviceFees,
  );
  saveSpending(spendingTracker);

  return data;
}

// --- Tool: Check spending policy ---
export function checkSpendingPolicy(
  amount: number,
  category: 'medications' | 'bills',
) {
  const budget =
    category === 'medications'
      ? currentPolicy.medicationMonthlyBudget
      : currentPolicy.billMonthlyBudget;
  const currentSpending =
    category === 'medications'
      ? spendingTracker.medications
      : spendingTracker.bills;
  const remaining = budget - currentSpending;

  if (amount > remaining) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} exceeds ${category} monthly budget. Budget: $${budget}, spent: $${currentSpending.toFixed(2)}, remaining: $${remaining.toFixed(2)}`,
      requiresApproval: false,
      currentSpending,
      budgetRemaining: remaining,
    };
  }

  const today = getLocalDateStr(SPENDING_TIMEZONE);
  const totalToday = spendingTracker.transactions
    .filter(
      (t) =>
        getLocalDateStr(SPENDING_TIMEZONE, new Date(t.timestamp)) === today &&
        t.category === category,
    )
    .reduce((sum, t) => sum + t.amount, 0);

  if (totalToday + amount > currentPolicy.dailyLimit) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} would exceed daily limit of $${currentPolicy.dailyLimit}. Already spent today: $${totalToday.toFixed(2)}`,
      requiresApproval: false,
      currentSpending,
      budgetRemaining: remaining,
    };
  }

  return {
    allowed: true,
    requiresApproval: amount > currentPolicy.approvalThreshold,
    currentSpending,
    budgetRemaining: remaining - amount,
  };
}

async function executeMedicationPayment(
  pharmacyId: string,
  pharmacyName: string,
  drugName: string,
  amount: number,
) {
  logger.info(
    { pharmacy: pharmacyName, amount },
    '[MPP] paying for medication',
  );

  let stellarTxHash: string | undefined;
  let mppOrderId: string | undefined;
  lastMppTxHash = undefined;

  try {
    const response = await mppClient.fetch(
      `${PHARMACY_PAYMENT_API}/pharmacy/order`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drug: drugName,
          pharmacy: pharmacyName,
          amount,
        }),
      },
    );

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'MPP payment failed');
    }

    stellarTxHash = lastMppTxHash;
    if (!stellarTxHash) {
      const receiptHeader =
        response.headers.get('Payment-Receipt') ||
        response.headers.get('payment-receipt');
      if (receiptHeader) {
        try {
          const receipt = JSON.parse(
            Buffer.from(receiptHeader, 'base64').toString(),
          );
          stellarTxHash =
            receipt.reference || receipt.hash || receipt.transaction;
        } catch {
          stellarTxHash = receiptHeader;
        }
      }
    }

    mppOrderId = data.order?.id;
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    return { success: false, error: `MPP payment failed: ${err.message}` };
  }

  stellarTxSubmittedTotal.inc({ result: 'success' });
  paymentsUsdcTotal.inc({ type: 'medication' });

  return { success: true, stellarTxHash, mppOrderId };
}

async function executeBillPayment(
  providerId: string,
  providerName: string,
  description: string,
  amount: number,
) {
  const recipientKey = process.env.BILL_PROVIDER_PUBLIC_KEY;
  if (!recipientKey) {
    return { success: false, error: 'BILL_PROVIDER_PUBLIC_KEY not configured' };
  }

  logger.info(
    { provider: providerName, amount },
    '[Stellar] transferring USDC',
  );

  let stellarTxHash: string | undefined;
  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcAsset = new Asset('USDC', USDC_ISSUER);

    const stellarTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: recipientKey,
          asset: usdcAsset,
          amount: amount.toFixed(7),
        }),
      )
      .setTimeout(30)
      .build();

    stellarTx.sign(agentKeypair);

    const sigHint = stellarTx.signatures[0]?.hint();
    if (!sigHint || !sigHint.equals(agentKeypair.signatureHint())) {
      throw new Error(
        `Signer mismatch: expected ${agentKeypair.publicKey()} — refusing to submit`,
      );
    }

    const result = await submitTransactionWithRetry(horizonServer, stellarTx);
    stellarTxHash = result.hash;
    logger.info({ txHash: stellarTxHash }, '[Stellar] TX confirmed');
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    const errorDetail =
      err?.response?.data?.extras?.result_codes || err.message;
    return {
      success: false,
      error: `Stellar USDC transfer failed: ${JSON.stringify(errorDetail)}`,
    };
  }

  stellarTxSubmittedTotal.inc({ result: 'success' });
  paymentsUsdcTotal.inc({ type: 'bill' });

  return { success: true, stellarTxHash };
}

async function getPendingTransaction(txId: string) {
  const tracker = getSpendingTracker();
  const tx = tracker.transactions.find((t: any) => t.id === txId);
  if (!tx) {
    return { error: 'Transaction not found' };
  }
  if (tx.status !== 'pending') {
    return { error: 'Transaction is not pending' };
  }
  return { tx, tracker };
}

export async function approvePendingTransaction(txId: string) {
  const tracker = loadSpending();
  const tx = tracker.transactions.find((t: any) => t.id === txId);
  if (!tx) return { success: false, error: 'Transaction not found' };
  if (tx.status !== 'pending')
    return { success: false, error: 'Transaction is not pending' };

  let result: any;
  try {
    if (tx.category === 'medications') {
      const match = tx.description.match(/(.+) from (.+)/);
      if (!match) throw new Error('Cannot parse transaction description');
      const [, drugName, pharmacyName] = match;
      result = await executeMedicationPayment(
        tx.recipient,
        pharmacyName,
        drugName,
        tx.amount,
      );
    } else if (tx.category === 'bills') {
      const match = tx.description.match(/(.+) — (.+)/);
      if (!match) throw new Error('Cannot parse transaction description');
      const [, description, providerName] = match;
      result = await executeBillPayment(
        tx.recipient,
        providerName,
        description,
        tx.amount,
      );
    } else {
      throw new Error('Unknown transaction category');
    }
  } catch (err: any) {
    tx.status = 'rejected';
    saveSpending(tracker);
    spendingTracker = tracker;
    return { success: false, error: err.message };
  }

  if (!result.success) {
    tx.status = 'rejected';
    saveSpending(tracker);
    spendingTracker = tracker;
    return { success: false, error: result.error };
  }

  tx.status = 'completed';
  tx.stellarTxHash = result.stellarTxHash;
  if (result.mppOrderId) tx.mppOrderId = result.mppOrderId;

  if (tx.category === 'medications') {
    spendingTracker.medications += tx.amount;
    agentSpendingUsd.set(
      { category: 'medications' },
      spendingTracker.medications,
    );
  } else if (tx.category === 'bills') {
    spendingTracker.bills += tx.amount;
    agentSpendingUsd.set({ category: 'bills' }, spendingTracker.bills);
  }
  agentTransactionsTotal.inc({ status: 'completed' });
  tracker.transactions = tracker.transactions.map((t: any) =>
    t.id === tx.id ? tx : t,
  );
  saveSpending(tracker);
  spendingTracker = tracker;

  return { success: true, transaction: tx };
}

export function cancelPendingTransaction(txId: string) {
  const tracker = loadSpending();
  const tx = tracker.transactions.find((t: any) => t.id === txId);
  if (!tx) return { success: false, error: 'Transaction not found' };
  if (tx.status !== 'pending')
    return { success: false, error: 'Transaction is not pending' };

  tx.status = 'cancelled';
  tracker.transactions = tracker.transactions.map((t: any) =>
    t.id === tx.id ? tx : t,
  );
  saveSpending(tracker);
  spendingTracker = tracker;
  return { success: true, transaction: tx };
}

export async function processPendingTransactions() {
  const tracker = loadSpending();
  const now = Date.now();
  const pending = tracker.transactions.filter(
    (t: any) =>
      t.status === 'pending' &&
      t.pendingUntil &&
      new Date(t.pendingUntil).getTime() <= now,
  );
  for (const tx of pending) {
    await approvePendingTransaction(tx.id);
  }
  return { processed: pending.map((t: any) => t.id) };
}

// --- Tool: Pay for medication via MPP Charge (real Stellar payment) ---
export async function payForMedication(
  pharmacyId: string,
  pharmacyName: string,
  drugName: string,
  amount: number,
  skipApproval: boolean = false,
) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return {
      success: false,
      error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.`,
    };
  }
  const policyCheck = checkSpendingPolicy(amount, 'medications');
  if (!policyCheck.allowed) {
    const reason = policyCheck.reason.includes('daily')
      ? 'daily_limit'
      : 'budget';
    policyBlocksTotal.inc({ reason });
    return {
      success: false,
      error: `BLOCKED BY SPENDING POLICY: ${policyCheck.reason}`,
    };
  }
  if (policyCheck.requiresApproval && !skipApproval) {
    policyBlocksTotal.inc({ reason: 'approval_required' });
    const holdSeconds = (currentPolicy as any)?.holdTimeSeconds ?? 0;
    const submittedAt = new Date().toISOString();
    const pendingUntil = new Date(
      Date.now() + holdSeconds * 1000,
    ).toISOString();
    const tx: Transaction & { pendingUntil?: string; submittedAt?: string } = {
      id: `tx-${Date.now()}`,
      timestamp: submittedAt,
      type: 'medication',
      description: `${drugName} from ${pharmacyName}`,
      amount,
      recipient: pharmacyId,
      status: 'pending',
      category: 'medications',
      pendingUntil,
      submittedAt,
    };
    spendingTracker.transactions.push(tx);
    agentTransactionsTotal.inc({ status: 'pending' });
    saveSpending(spendingTracker);
    return {
      success: false,
      error: `REQUIRES CAREGIVER APPROVAL: $${amount.toFixed(2)} exceeds the $${currentPolicy.approvalThreshold} approval threshold.`,
      transaction: tx,
    };
  }

  // Execute real MPP charge payment to pharmacy
  logger.info(
    { pharmacy: pharmacyName, amount },
    '[MPP] paying for medication',
  );

  let stellarTxHash: string | undefined;
  let mppOrderId: string | undefined;
  lastMppTxHash = undefined; // reset before this payment

  try {
    const response = await mppClient.fetch(
      `${PHARMACY_PAYMENT_API}/pharmacy/order`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drug: drugName,
          pharmacy: pharmacyName,
          amount,
        }),
      },
    );

    const data = await response.json();
    if (data.success) {
      // Try to get tx hash from: 1) MPP progress event, 2) Payment-Receipt header
      stellarTxHash = lastMppTxHash;
      if (!stellarTxHash) {
        const receiptHeader =
          response.headers.get('Payment-Receipt') ||
          response.headers.get('payment-receipt');
        if (receiptHeader) {
          try {
            const receipt = JSON.parse(
              Buffer.from(receiptHeader, 'base64').toString(),
            );
            stellarTxHash =
              receipt.reference || receipt.hash || receipt.transaction;
          } catch {
            stellarTxHash = receiptHeader;
          }
        }
      }
      // data.order.id is an MPP order identifier — kept separate from stellarTxHash
      mppOrderId = data.order?.id;
    } else {
      throw new Error(data.error || 'MPP payment failed');
    }
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    return { success: false, error: `MPP payment failed: ${err.message}` };
  }

  stellarTxSubmittedTotal.inc({ result: 'success' });
  paymentsUsdcTotal.inc({ type: 'medication' });

  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'medication',
    description: `${drugName} from ${pharmacyName} [MPP Charge]`,
    amount,
    recipient: pharmacyId,
    stellarTxHash,
    mppOrderId,
    status: 'completed',
    category: 'medications',
  };

  spendingTracker.medications += amount;
  spendingTracker.transactions.push(tx);
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: 'medications' },
    spendingTracker.medications,
  );
  saveSpending(spendingTracker);

  return { success: true, transaction: tx };
}

// --- Tool: Pay a medical bill via real Stellar USDC transfer ---
export async function payBill(
  providerId: string,
  providerName: string,
  description: string,
  amount: number,
  skipApproval: boolean = false,
) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return {
      success: false,
      error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.`,
    };
  }
  const policyCheck = checkSpendingPolicy(amount, 'bills');
  if (!policyCheck.allowed) {
    const reason = policyCheck.reason.includes('daily')
      ? 'daily_limit'
      : 'budget';
    policyBlocksTotal.inc({ reason });
    return {
      success: false,
      error: `BLOCKED BY SPENDING POLICY: ${policyCheck.reason}`,
    };
  }
  if (policyCheck.requiresApproval && !skipApproval) {
    policyBlocksTotal.inc({ reason: 'approval_required' });
    const holdSeconds = (currentPolicy as any)?.holdTimeSeconds ?? 0;
    const submittedAt = new Date().toISOString();
    const pendingUntil = new Date(
      Date.now() + holdSeconds * 1000,
    ).toISOString();
    const tx: Transaction & { pendingUntil?: string; submittedAt?: string } = {
      id: `tx-${Date.now()}`,
      timestamp: submittedAt,
      type: 'bill',
      description: `${description} — ${providerName}`,
      amount,
      recipient: providerId,
      status: 'pending',
      category: 'bills',
      pendingUntil,
      submittedAt,
    };
    spendingTracker.transactions.push(tx);
    agentTransactionsTotal.inc({ status: 'pending' });
    saveSpending(spendingTracker);
    return {
      success: false,
      error: `REQUIRES CAREGIVER APPROVAL: $${amount.toFixed(2)} exceeds the $${currentPolicy.approvalThreshold} approval threshold.`,
      transaction: tx,
    };
  }

  // Execute real Stellar USDC transfer
  const recipientKey = process.env.BILL_PROVIDER_PUBLIC_KEY;
  if (!recipientKey)
    return { success: false, error: 'BILL_PROVIDER_PUBLIC_KEY not configured' };

  logger.info(
    { provider: providerName, amount },
    '[Stellar] transferring USDC',
  );

  let stellarTxHash: string | undefined;

  try {
    const account = await horizonServer.loadAccount(agentKeypair.publicKey());
    const usdcAsset = new Asset('USDC', USDC_ISSUER);

    const stellarTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: recipientKey,
          asset: usdcAsset,
          amount: amount.toFixed(7),
        }),
      )
      .setTimeout(30)
      .build();

    stellarTx.sign(agentKeypair);

    // Belt-and-braces: verify the signed envelope's signer hint matches the agent keypair
    // before broadcast — cheap guard against future wallet mix-ups.
    const sigHint = stellarTx.signatures[0]?.hint();
    if (!sigHint || !sigHint.equals(agentKeypair.signatureHint())) {
      throw new Error(
        `Signer mismatch: expected ${agentKeypair.publicKey()} — refusing to submit`,
      );
    }
    console.log(
      `  [Stellar] Signer verified: ${agentKeypair.publicKey().slice(0, 8)}...`,
    );

    const result = await submitTransactionWithRetry(horizonServer, stellarTx);
    stellarTxHash = result.hash;
    logger.info({ txHash: stellarTxHash }, '[Stellar] TX confirmed');
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    const errorDetail =
      err?.response?.data?.extras?.result_codes || err.message;
    return {
      success: false,
      error: `Stellar USDC transfer failed: ${JSON.stringify(errorDetail)}`,
    };
  }

  stellarTxSubmittedTotal.inc({ result: 'success' });
  paymentsUsdcTotal.inc({ type: 'bill' });

  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'bill',
    description: `${description} — ${providerName} [Stellar USDC]`,
    amount,
    recipient: providerId,
    stellarTxHash,
    status: 'completed',
    category: 'bills',
  };

  spendingTracker.bills += amount;
  spendingTracker.transactions.push(tx);
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set({ category: 'bills' }, spendingTracker.bills);
  saveSpending(spendingTracker);

  return { success: true, transaction: tx };
}

// --- Tool: Get spending summary ---
export function getSpendingSummary() {
  const total =
    spendingTracker.medications +
    spendingTracker.bills +
    spendingTracker.serviceFees;
  return {
    policy: currentPolicy,
    spending: {
      medications: +spendingTracker.medications.toFixed(2),
      bills: +spendingTracker.bills.toFixed(2),
      serviceFees: +spendingTracker.serviceFees.toFixed(4),
      total: +total.toFixed(2),
    },
    budgetRemaining: {
      medications: +(
        currentPolicy.medicationMonthlyBudget - spendingTracker.medications
      ).toFixed(2),
      bills: +(currentPolicy.billMonthlyBudget - spendingTracker.bills).toFixed(
        2,
      ),
    },
    transactionCount: spendingTracker.transactions.length,
    recentTransactions: spendingTracker.transactions.slice(-5),
  };
}

// --- Tool: Get wallet balance from Horizon ---
export async function getWalletBalance() {
  const address = agentKeypair.publicKey();
  logger.info({ address }, '[Horizon] fetching wallet balance');

  try {
    const account = await horizonServer.loadAccount(address);

    const usdcBalance = account.balances.find(
      (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
    );

    const xlmBalance = account.balances.find(
      (b: any) => b.asset_type === 'native',
    );

    return {
      address,
      balances: {
        usdc: usdcBalance
          ? parseFloat((usdcBalance as any).balance).toFixed(2)
          : '0.00',
        xlm: xlmBalance
          ? parseFloat((xlmBalance as any).balance).toFixed(2)
          : '0.00',
      },
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    logger.error(
      { err: err.message, address },
      '[Horizon] failed to fetch balance',
    );
    throw new Error(`Failed to fetch wallet balance: ${err.message}`);
  }
}

// Claude API tool definitions
export const TOOL_DEFINITIONS = [
  {
    name: 'compare_pharmacy_prices',
    description:
      'Compare medication prices across multiple pharmacies. Pays $0.002 USDC per query via x402 on Stellar. Returns prices sorted cheapest to most expensive, with potential savings.',
    input_schema: {
      type: 'object' as const,
      properties: {
        drug_name: {
          type: 'string',
          description: 'Name of the medication (e.g., Lisinopril, Metformin)',
        },
        zip_code: {
          type: 'string',
          description: 'ZIP code for pharmacy location (default: 90210)',
        },
      },
      required: ['drug_name'],
    },
  },
  {
    name: 'audit_medical_bill',
    description:
      'Audit a medical bill for errors (duplicates, upcoding, overcharges). 80% of medical bills contain errors. Pays $0.01 USDC per audit via x402 on Stellar. Pass line_items as a JSON string array of objects with fields: description, cptCode, quantity, chargedAmount.',
    input_schema: {
      type: 'object' as const,
      properties: {
        line_items_json: {
          type: 'string',
          description:
            'JSON string of line items array. Each item: {"description":"...","cptCode":"...","quantity":1,"chargedAmount":100}',
        },
      },
      required: ['line_items_json'],
    },
  },
  {
    name: 'check_drug_interactions',
    description:
      'Check for drug-drug interactions. Pays $0.001 USDC per check via x402 on Stellar. Returns severity levels and clinical recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        medications: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of medication names',
        },
      },
      required: ['medications'],
    },
  },
  {
    name: 'pay_for_medication',
    description:
      'Pay a pharmacy for a medication order via MPP Charge on Stellar (real USDC payment). Subject to spending policy limits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pharmacy_id: { type: 'string' },
        pharmacy_name: { type: 'string' },
        drug_name: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['pharmacy_id', 'pharmacy_name', 'drug_name', 'amount'],
    },
  },
  {
    name: 'pay_bill',
    description:
      'Pay a medical bill via direct Stellar USDC transfer. Subject to spending policy limits. If the bill has been audited and errors found, pay only the corrected amount.',
    input_schema: {
      type: 'object' as const,
      properties: {
        provider_id: { type: 'string' },
        provider_name: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['provider_id', 'provider_name', 'description', 'amount'],
    },
  },
  {
    name: 'check_spending_policy',
    description:
      'Check if a payment amount is within the caregiver-set spending policy limits before attempting payment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number' },
        category: { type: 'string', enum: ['medications', 'bills'] },
      },
      required: ['amount', 'category'],
    },
  },
  {
    name: 'fetch_rosa_bill',
    description:
      "Fetch Rosa Garcia's hospital bill from General Hospital. Returns the bill with line items including CPT codes and charged amounts.",
    input_schema: {
      type: 'object' as const,
      properties: {
        _unused: {
          type: 'string',
          description: 'Not used. Pass empty string.',
        },
      },
      required: [] as string[],
    },
  },
  {
    name: 'fetch_and_audit_bill',
    description:
      "Fetch Rosa's hospital bill from General Hospital AND audit it for errors in one step. Pays $0.01 USDC via x402. Returns the audit results with errors found, overcharges, and corrected total. Use this instead of calling fetch_rosa_bill + audit_medical_bill separately.",
    input_schema: {
      type: 'object' as const,
      properties: {
        _unused: {
          type: 'string',
          description: 'Not used. Pass empty string.',
        },
      },
      required: [] as string[],
    },
  },
  {
    name: 'get_spending_summary',
    description:
      'Get current spending summary: total spent, budget remaining per category, recent transactions with Stellar tx hashes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        _unused: {
          type: 'string',
          description: 'Not used. Pass empty string.',
        },
      },
      required: [] as string[],
    },
  },
  {
    name: 'get_wallet_balance',
    description:
      'Get the current on-chain wallet balance (USDC and XLM) from Stellar Horizon. Returns real-time balance data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        _unused: {
          type: 'string',
          description: 'Not used. Pass empty string.',
        },
      },
      required: [] as string[],
    },
  },
];

// Start scanner (runs in-process). Interval is conservative (5s).
setInterval(() => {
  processPendingTransactions().catch((err) => {
    logger.error(
      { err: err?.message || err },
      '[PendingScanner] error scanning pending transactions',
    );
  });
}, 5000);
