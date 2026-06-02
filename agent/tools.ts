/**
 * CareGuard Agent Tools — Real payment integrations on Stellar testnet
 *
 * Supports multiple care recipients via per-recipient data directories.
 *   data/recipients/<recipientId>/spending.json
 *   data/recipients/<recipientId>/orders.json
 *   data/recipients/<recipientId>/policy.json
 *
 * x402 client: Signs Soroban auth entries, pays USDC per API query via OZ facilitator
 * MPP client: Signs Soroban transfers, pays pharmacies via MPP charge mode
 * Stellar USDC: Direct USDC transfers for bill payments via Horizon
 * Spending policy: Persisted to file, enforced before every payment.
 *   ⚠️  DO NOT COMMIT files under data/recipients/ — they contain
 *   live balances and transaction history. Add them to .gitignore and never
 *   include them in a PR. See data/README.md for details.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { z } from 'zod';
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
import { createMppClient, type MppClientInstance } from './mpp-client.ts';
import type { SpendingPolicy, Transaction } from '../shared/types.ts';
import { SPENDING_TIMEZONE, getLocalDateStr } from './tz.ts';
export { SPENDING_TIMEZONE, getLocalDateStr };
import { appendAuditEntry } from '../shared/audit-log.ts';
import { notify } from '../shared/notifications.ts';
import {
  getAdherenceSummary,
  getPendingAdherences,
  getFlaggedAdherences,
  confirmAdherence,
} from '../shared/adherence.ts';
import {
  x402SettlementsTotal,
  paymentsUsdcTotal,
  stellarTxSubmittedTotal,
  policyBlocksTotal,
  agentSpendingUsd,
  agentTransactionsTotal,
} from '../shared/metrics.ts';
import {
  assertMockNetworkAllowed,
  createMockReceipt,
  isMockNetwork,
} from '../shared/network-mode.ts';

assertMockNetworkAllowed();

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
const MIN_FEE_STROOPS = 100;
const MAX_FEE_STROOPS = parseInt(process.env.MAX_FEE_STROOPS || '100000'); // Cap at 0.01 XLM default

if (!AGENT_SECRET_KEY) throw new Error('AGENT_SECRET_KEY required in .env');

const agentKeypair = Keypair.fromSecret(AGENT_SECRET_KEY);
const horizonServer = new Horizon.Server(HORIZON_URL);

// Helper: calculate recommended fee based on network conditions
async function getRecommendedFee(): Promise<string> {
  try {
    const feeStats = await horizonServer.feeStats();
    const recommendedFee = parseInt(feeStats.fee_charged.mode, 10);
    // Use 1.5x the recommended fee to ensure acceptance during congestion
    const adjustedFee = Math.max(MIN_FEE_STROOPS, Math.ceil(recommendedFee * 1.5));
    const cappedFee = Math.min(adjustedFee, MAX_FEE_STROOPS);
    return cappedFee.toString();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, '[Stellar] Failed to fetch fee stats, using minimum fee');
    return MIN_FEE_STROOPS.toString();
  }
}

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
      const result = await server.submitTransaction(tx, { timeout: timeoutMs } as any);
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

// Helper: submit transaction with automatic fee bump on insufficient_fee error
async function submitTransactionWithFeeBump(
  server: Horizon.Server,
  account: any,
  operations: any[],
  signer: Keypair,
  initialFee?: string,
): Promise<{ hash: string; fee: string }> {
  let currentFee = initialFee || await getRecommendedFee();
  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    try {
      const tx = new TransactionBuilder(account, {
        fee: currentFee,
        networkPassphrase: Networks.TESTNET,
      });

      for (const op of operations) {
        tx.addOperation(op);
      }

      const builtTx = tx.setTimeout(30).build();
      builtTx.sign(signer);

      const result = await submitTransactionWithRetry(server, builtTx);
      return { hash: result.hash, fee: currentFee };
    } catch (err: any) {
      const resultCodes = err?.response?.data?.extras?.result_codes;
      const isFeeError = resultCodes?.transaction === 'tx_insufficient_fee';

      if (isFeeError && attempt < maxAttempts - 1) {
        // Double the fee and retry
        const newFee = Math.min(parseInt(currentFee) * 2, MAX_FEE_STROOPS);
        logger.warn(
          { oldFee: currentFee, newFee, attempt: attempt + 1 },
          '[Stellar] Insufficient fee, retrying with higher fee',
        );
        currentFee = newFee.toString();
        attempt++;
        continue;
      }

      throw err;
    }
  }

  throw new Error('Failed to submit transaction after fee bump retries');
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
const x402Fetch = isMockNetwork()
  ? fetch
  : wrapFetchWithPayment(
      fetch,
      new x402Client().register(
        'stellar:testnet',
        new ExactStellarScheme(
          createEd25519Signer(AGENT_SECRET_KEY, 'stellar:testnet'),
        ),
      ),
    );

// --- MPP Client: Auto-handles 402 for medication order payments ---
// Use factory function to create client instance (supports DI for testing)
let mppClient: MppClientInstance = isMockNetwork()
  ? {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const receipt = createMockReceipt('mpp', {
          url: String(input),
          body: init?.body ? String(init.body) : '',
        });
        return new Response(
          JSON.stringify({
            success: true,
            order: { id: receipt.receiptId },
            receipt,
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Payment-Receipt': Buffer.from(
                JSON.stringify({ reference: receipt.stellarTxHash }),
              ).toString('base64'),
            },
          },
        );
      },
      get lastTxHash() {
        return undefined;
      },
    }
  : createMppClient({
      keypair: agentKeypair,
      mode: 'pull',
    });

/**
 * Set a custom MPP client instance (for testing/DI).
 * @param client - MPP client instance to use
 */
export function setMppClient(client: MppClientInstance) {
  mppClient = client;
}

/**
 * Get the current MPP client instance.
 * @returns Current MPP client
 */
export function getMppClient(): MppClientInstance {
  return mppClient;
}

// --- Per-recipient data directories (Issue #261) ---
const DATA_DIR = new URL('../data', import.meta.url).pathname;

let currentRecipientId = 'rosa';

const DEFAULT_POLICY: SpendingPolicy = {
  dailyLimit: 100,
  monthlyLimit: 500,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
  notifications: { email: false, sms: false },
};

export function setCurrentRecipient(recipientId: string) {
  currentRecipientId = recipientId;
  const dir = getRecipientDir(recipientId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
export function getCurrentRecipient() { return currentRecipientId; }

function getRecipientDir(recipientId: string): string {
  return `${DATA_DIR}/recipients/${recipientId}`;
}
function getSpendingFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/spending.json`;
}
function getPolicyFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/policy.json`;
}
function getOrdersFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/orders.json`;
}

// Migrate legacy flat files to per-recipient structure (one-time)
function migrateLegacyData() {
  const legacySpending = `${DATA_DIR}/spending.json`;
  const legacyOrders = `${DATA_DIR}/orders.json`;
  const rosaDir = getRecipientDir('rosa');
  if (!existsSync(rosaDir)) mkdirSync(rosaDir, { recursive: true });
  if (existsSync(legacySpending) && !existsSync(`${rosaDir}/spending.json`)) {
    const data = readFileSync(legacySpending, 'utf-8');
    writeFileSync(`${rosaDir}/spending.json`, data);
  }
  if (existsSync(legacyOrders) && !existsSync(`${rosaDir}/orders.json`)) {
    const data = readFileSync(legacyOrders, 'utf-8');
    writeFileSync(`${rosaDir}/orders.json`, data);
  }
  if (!existsSync(`${rosaDir}/policy.json`)) {
    writeFileSync(`${rosaDir}/policy.json`, JSON.stringify(DEFAULT_POLICY, null, 2));
  }
}
migrateLegacyData();

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(getRecipientDir(currentRecipientId))) mkdirSync(getRecipientDir(currentRecipientId), { recursive: true });

interface SpendingTracker {
  medications: number;
  bills: number;
  serviceFees: number;
  transactions: Transaction[];
}

type SpendingPolicyInput = Partial<SpendingPolicy> & {
  dailyLimit: number;
  monthlyLimit: number;
  medicationMonthlyBudget: number;
  billMonthlyBudget: number;
  approvalThreshold: number;
};

function loadSpending(recipientId?: string): SpendingTracker {
  const file = getSpendingFile(recipientId);
  if (!existsSync(file)) return { medications: 0, bills: 0, serviceFees: 0, transactions: [] };
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export function saveSpending(data: SpendingTracker, recipientId?: string) {
  const file = getSpendingFile(recipientId);
  writeFileSync(file, JSON.stringify(data, null, 2));
}

let spendingTracker = loadSpending();

const MAX_PAYMENT = 1000;
const MAX_ERROR_LENGTH = 500;

function truncateError(message: string): string {
  return message.replace(/<[^>]*>/g, '').slice(0, MAX_ERROR_LENGTH);
}

function recordServiceFee(
  amount: number,
  description: string,
  recipient: string,
  stellarTxHash?: string,
) {
  x402SettlementsTotal.inc();
  spendingTracker.serviceFees += amount;
  spendingTracker.transactions.push({
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'service_fee',
    description,
    amount,
    recipient,
    stellarTxHash,
    status: 'completed',
    category: 'service_fees',
  });
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: 'service_fees' },
    spendingTracker.serviceFees,
  );
  saveSpending(spendingTracker);
}

function loadPolicy(recipientId?: string): SpendingPolicy {
  const file = getPolicyFile(recipientId);
  if (!existsSync(file)) return { ...DEFAULT_POLICY };
  try { return JSON.parse(readFileSync(file, 'utf-8')); }
  catch { return { ...DEFAULT_POLICY }; }
}

function savePolicy(policy: SpendingPolicy, recipientId?: string) {
  writeFileSync(getPolicyFile(recipientId), JSON.stringify(policy, null, 2));
}

let currentPolicy: SpendingPolicy = loadPolicy();

export function setSpendingPolicy(policy: SpendingPolicyInput): void;
export function setSpendingPolicy(recipientId: string, policy: SpendingPolicyInput): void;
export function setSpendingPolicy(
  policyOrRecipientId: SpendingPolicyInput | string,
  maybePolicy?: SpendingPolicyInput,
) {
  if (typeof policyOrRecipientId === 'string') {
    setCurrentRecipient(policyOrRecipientId);
  }
  const policy =
    typeof policyOrRecipientId === 'string' ? maybePolicy : policyOrRecipientId;
  if (!policy) {
    throw new Error('Spending policy required');
  }
  const normalizedPolicy: SpendingPolicy = {
    ...DEFAULT_POLICY,
    ...policy,
    notifications: {
      ...DEFAULT_POLICY.notifications,
      ...(policy.notifications || {}),
      email: policy.notifications?.email ?? false,
      sms: policy.notifications?.sms ?? false,
    },
  };
  const previous = currentPolicy;
  currentPolicy = normalizedPolicy;
  savePolicy(normalizedPolicy);
  appendAuditEntry({
    event: 'policy.updated',
    actor: 'caregiver',
    details: {
      previous: { ...previous },
      current: { ...normalizedPolicy },
    },
  });
  notify({
    level: "info",
    title: "Spending Policy Updated",
    description: `Daily: $${normalizedPolicy.dailyLimit}, Monthly: $${normalizedPolicy.monthlyLimit}, Meds: $${normalizedPolicy.medicationMonthlyBudget}, Bills: $${normalizedPolicy.billMonthlyBudget}, Approval: $${normalizedPolicy.approvalThreshold}`,
  });
}
export function getSpendingTracker(): any {
  return { ...spendingTracker, policy: currentPolicy };
}
export function resetSpendingTracker(recipientId?: string) {
  if (recipientId) {
    setCurrentRecipient(recipientId);
  }
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

  if (isMockNetwork()) {
    const receipt = createMockReceipt('x402:pharmacy-prices', {
      drugName,
      zipCode,
    });
    const data = {
      drug: drugName,
      zipCode,
      protocol: {
        name: 'x402',
        mockNetwork: true,
        price: '$0.002',
        payTo: 'mock-pharmacy-price-api',
        receipt,
      },
      prices: [
        {
          pharmacyName: 'MockCare Pharmacy',
          pharmacyId: 'mock-pharmacy-1',
          price: 4.25,
          distance: '1.0 mi',
          inStock: 'unknown',
        },
        {
          pharmacyName: 'MockTown Drugs',
          pharmacyId: 'mock-pharmacy-2',
          price: 9.75,
          distance: '2.4 mi',
          inStock: 'unknown',
        },
      ],
      cheapest: {
        pharmacyName: 'MockCare Pharmacy',
        pharmacyId: 'mock-pharmacy-1',
        price: 4.25,
        distance: '1.0 mi',
      },
      mostExpensive: {
        pharmacyName: 'MockTown Drugs',
        pharmacyId: 'mock-pharmacy-2',
        price: 9.75,
      },
      potentialSavings: 5.5,
      savingsPercent: 56.4,
    };
    recordServiceFee(
      0.002,
      `x402 query: pharmacy prices for ${drugName}`,
      'mock-pharmacy-price-api',
      receipt.stellarTxHash,
    );
    return data;
  }

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

  recordServiceFee(
    0.002,
    `x402 query: pharmacy prices for ${drugName}`,
    data.protocol?.payTo || 'pharmacy-price-api',
    txHash,
  );

  return data;
}

// --- Tool: Fetch Rosa's hospital bill (free endpoint, no x402 payment) ---
export async function fetchRosaBill() {
  logger.info("[fetch] getting Rosa's hospital bill");

  if (isMockNetwork()) {
    return {
      patientName: 'Rosa Garcia',
      facilityName: 'Mock General Hospital',
      dateOfService: '2026-03-15',
      lineItems: [
        {
          description: 'Office visit, moderate',
          cptCode: '99213',
          quantity: 1,
          chargedAmount: 130,
        },
      ],
    };
  }

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
  const bill = await fetchRosaBill();

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

  if (isMockNetwork()) {
    const receipt = createMockReceipt('x402:bill-audit', { lineItems });
    const totalCharged = lineItems.reduce(
      (sum, item) => sum + item.chargedAmount,
      0,
    );
    const data = {
      auditTimestamp: new Date().toISOString(),
      protocol: {
        name: 'x402',
        mockNetwork: true,
        price: '$0.01',
        payTo: 'mock-bill-audit-api',
        receipt,
      },
      totalCharged: +totalCharged.toFixed(2),
      totalCorrect: +totalCharged.toFixed(2),
      totalOvercharge: 0,
      savingsPercent: 0,
      errorCount: 0,
      lineItems: lineItems.map((item) => ({
        ...item,
        status: 'valid',
        errorDescription: null,
        suggestedAmount: item.chargedAmount,
      })),
      recommendation: 'Mock network audit completed. No errors detected.',
    };
    recordServiceFee(
      0.01,
      'x402 query: medical bill audit',
      'mock-bill-audit-api',
      receipt.stellarTxHash,
    );
    return data;
  }

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

  recordServiceFee(
    0.01,
    'x402 query: medical bill audit',
    data.protocol?.payTo || 'bill-audit-api',
    txHash,
  );

  return data;
}

// --- Tool: Check drug interactions (pays via x402) ---
export async function checkDrugInteractions(medications: string[]) {
  const medsParam = medications.join(',');
  logger.info(
    { medicationCount: medications.length },
    '[x402] paying for drug interaction check',
  );

  if (isMockNetwork()) {
    const receipt = createMockReceipt('x402:drug-interactions', {
      medications,
    });
    const data = {
      medications,
      protocol: {
        name: 'x402',
        mockNetwork: true,
        price: '$0.001',
        payTo: 'mock-drug-interaction-api',
        receipt,
      },
      interactions: [],
      summary: 'Mock network interaction check completed. No interactions detected.',
    };
    recordServiceFee(
      0.001,
      `x402 query: drug interactions for ${medications.join(', ')}`,
      'mock-drug-interaction-api',
      receipt.stellarTxHash,
    );
    return data;
  }

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

  recordServiceFee(
    0.001,
    `x402 query: drug interactions for ${medications.join(', ')}`,
    data.protocol?.payTo || 'drug-interaction-api',
    txHash,
  );

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
  const previousMppTxHash = mppClient.lastTxHash;

  if (isMockNetwork()) {
    const receipt = createMockReceipt('mpp:medication-order', {
      pharmacyId,
      pharmacyName,
      drugName,
      amount,
    });
    stellarTxSubmittedTotal.inc({ result: 'success' });
    paymentsUsdcTotal.inc({ type: 'medication' });
    return {
      success: true,
      stellarTxHash: receipt.stellarTxHash,
      mppOrderId: receipt.receiptId,
    };
  }

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

    stellarTxHash =
      mppClient.lastTxHash && mppClient.lastTxHash !== previousMppTxHash
        ? mppClient.lastTxHash
        : undefined;
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

    const paymentOp = Operation.payment({
      destination: recipientKey,
      asset: usdcAsset,
      amount: amount.toFixed(7),
    });

    const result = await submitTransactionWithFeeBump(
      horizonServer,
      account,
      [paymentOp],
      agentKeypair,
    );

    stellarTxHash = result.hash;
    logger.info({ txHash: stellarTxHash, fee: result.fee }, '[Stellar] TX confirmed');
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

export async function approvePendingTransaction(txId: string): Promise<any> {
  const tracker = spendingTracker;
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

export function cancelPendingTransaction(txId: string): any {
  const tracker = spendingTracker;
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
  const tracker = spendingTracker;
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
  daysSupply: number = 30,
  _recipientId?: string,
) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return {
      success: false,
      error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.`,
    };
  }
  const policyCheck = checkSpendingPolicy(amount, 'medications');
  if (!policyCheck.allowed) {
    const reason = policyCheck.reason!.includes('daily')
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
  const paymentResult = await executeMedicationPayment(
    pharmacyId,
    pharmacyName,
    drugName,
    amount,
  );
  if (!paymentResult.success) {
    return paymentResult;
  }

  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'medication',
    description: `${drugName} from ${pharmacyName} [MPP Charge]`,
    amount,
    recipient: pharmacyId,
    stellarTxHash: paymentResult.stellarTxHash,
    mppOrderId: paymentResult.mppOrderId,
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

  // Schedule adherence reminder (Issue #264)
  const reminderDate = new Date(Date.now() + daysSupply * 24 * 60 * 60 * 1000).toISOString();
  appendAdherenceEntry({
    recipientId: currentRecipientId,
    reminderDate,
    drug: drugName,
    orderId: paymentResult.mppOrderId || tx.id,
  });

  // Notify on significant payment (Issue #265)
  if (amount > currentPolicy.approvalThreshold) {
    notify({
      level: "info",
      title: "Medication Payment Made",
      description: `$${amount.toFixed(2)} paid for ${drugName} at ${pharmacyName}. Adherence reminder scheduled for ${new Date(reminderDate).toLocaleDateString()}.`,
      context: { recipientId: currentRecipientId, txId: tx.id, stellarTxHash: paymentResult.stellarTxHash },
    });
  }

  return { success: true, transaction: tx };
}

// --- Tool: Pay a medical bill via real Stellar USDC transfer ---
export async function payBill(
  providerId: string,
  providerName: string,
  description: string,
  amount: number,
  skipApproval: boolean = false,
  _recipientId?: string,
) {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) {
    return {
      success: false,
      error: `Invalid payment amount: $${amount}. Amount must be a positive finite number <= $${MAX_PAYMENT}.`,
    };
  }
  const policyCheck = checkSpendingPolicy(amount, 'bills');
  if (!policyCheck.allowed) {
    const reason = policyCheck.reason!.includes('daily')
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

    const paymentOp = Operation.payment({
      destination: recipientKey,
      asset: usdcAsset,
      amount: amount.toFixed(7),
    });

    const result = await submitTransactionWithFeeBump(
      horizonServer,
      account,
      [paymentOp],
      agentKeypair,
    );

    stellarTxHash = result.hash;
    logger.info({ txHash: stellarTxHash, fee: result.fee }, '[Stellar] TX confirmed');
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

  // Notify on significant payment (Issue #265)
  if (amount > currentPolicy.approvalThreshold) {
    notify({
      level: "info",
      title: "Bill Payment Made",
      description: `$${amount.toFixed(2)} paid to ${providerName} for ${description}`,
      context: { recipientId: currentRecipientId, txId: tx.id, stellarTxHash },
    });
  }

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
      usdcTrustlineMissing: !usdcBalance,
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

// --- Tool: Check medication adherence (Issue #264) ---
export function checkAdherence(recipientId?: string) {
  const id = recipientId || currentRecipientId;
  const file = ADHERENCE_FILE;
  if (!existsSync(file)) {
    return { pendingReminders: 0, entries: [], flagged: false };
  }
  const content = readFileSync(file, "utf-8").trim();
  if (!content) return { pendingReminders: 0, entries: [], flagged: false };

  const lines = content.split("\n").filter(Boolean);
  const entries: AdherenceEntry[] = lines.map(l => JSON.parse(l));
  const recipientEntries = entries.filter(e => e.recipientId === id);
  const now = new Date();
  const pending = recipientEntries.filter(e => !e.responded && new Date(e.reminderDate) <= now);
  const missed = recipientEntries.filter(e => e.responded && e.taken === false);
  const flagged = recipientEntries.some(e => e.flagged);

  return {
    pendingReminders: pending.length,
    totalEntries: recipientEntries.length,
    pending,
    missedDoses: missed.length,
    flagged,
    lastReminder: recipientEntries.length > 0 ? recipientEntries[recipientEntries.length - 1].reminderDate : null,
  };
}

// --- Helper: Load/save orders.json for a recipient ---
interface OrderRecord {
  id: string; drug: string; pharmacy: string; amount: number;
  status: string; timestamp: string; network?: string; protocol?: string;
}
function loadOrders(recipientId?: string): OrderRecord[] {
  const file = getOrdersFile(recipientId);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf-8"));
}
function saveOrders(orders: OrderRecord[], recipientId?: string) {
  writeFileSync(getOrdersFile(recipientId), JSON.stringify(orders, null, 2));
}

// --- Tool: Schedule an adherence reminder after pharmacy order (Issue #264) ---
const ADHERENCE_FILE = `${DATA_DIR}/adherence.jsonl`;
interface AdherenceEntry {
  recipientId: string;
  reminderDate: string;
  drug: string;
  orderId: string;
  responded: boolean;
  taken: boolean | null;
  skippedCount: number;
  flagged: boolean;
}
function appendAdherenceEntry(entry: Omit<AdherenceEntry, "responded" | "taken" | "skippedCount" | "flagged">) {
  const fullEntry: AdherenceEntry = { ...entry, responded: false, taken: null, skippedCount: 0, flagged: false };
  writeFileSync(ADHERENCE_FILE, JSON.stringify(fullEntry) + "\n", { flag: "a" });
}

// --- Tool: Generate a dispute letter PDF + email body (Issue #266) ---
export function generateDisputeLetter(
  billId: string,
  errorIds: string[],
  auditResult: { totalOvercharge: number; errorCount: number; lineItems: Array<{ description: string; cptCode?: string; chargedAmount: number; suggestedAmount?: number; errorDescription?: string }> },
  recipientInfo: { name: string; facility: string; caregiverName: string; caregiverEmail: string }
) {
  const errorItems = auditResult.lineItems.filter(
    (item) => errorIds.length === 0 || errorIds.includes(item.description)
  );

  const letterLines: string[] = [];
  letterLines.push(`Dear ${recipientInfo.facility} Billing Department,`);
  letterLines.push("");
  letterLines.push(`I am writing on behalf of ${recipientInfo.name}, a patient at your facility, to formally dispute the following billing errors identified in Bill #${billId}.`);
  letterLines.push("");
  letterLines.push("After auditing the bill, we found the following discrepancies:");
  letterLines.push("");

  for (const item of errorItems) {
    letterLines.push(`  - ${item.description}${item.cptCode ? ` (CPT: ${item.cptCode})` : ""}: Charged $${item.chargedAmount.toFixed(2)}`);
    if (item.suggestedAmount !== undefined) {
      letterLines.push(`    Fair market rate: $${item.suggestedAmount.toFixed(2)}`);
    }
    if (item.errorDescription) {
      letterLines.push(`    Issue: ${item.errorDescription}`);
    }
    letterLines.push("");
  }

  letterLines.push(`Total overcharge identified: $${auditResult.totalOvercharge.toFixed(2)}`);
  letterLines.push("");
  letterLines.push("We request that these charges be reviewed and corrected. Please adjust the bill to reflect the fair-market rates as outlined above.");
  letterLines.push("");
  letterLines.push("Thank you for your prompt attention to this matter.");
  letterLines.push("");
  letterLines.push("Sincerely,");
  letterLines.push(recipientInfo.caregiverName);
  letterLines.push(recipientInfo.caregiverEmail);

  const emailBody = letterLines.join("\n");
  const pdf = `careguard-dispute-letter-${billId}.pdf`;
  return { pdf, emailBody };
}

// --- Tool: Adherence status (Issue #264) ---
export function getAdherenceStatus(recipientId: string = "rosa") {
  const summary = getAdherenceSummary(recipientId);
  const pending = getPendingAdherences(recipientId);
  const flagged = getFlaggedAdherences(recipientId);
  return { ...summary, pendingReminders: pending.length, flaggedReminders: flagged };
}

export function confirmAdherenceReminder(recordId: string) {
  return { success: confirmAdherence(recordId) };
}

const recipientIdSchema = z.string().min(1).optional();
const amountSchema = z.union([z.number(), z.string()]);

const TOOL_INPUT_SCHEMAS = {
  compare_pharmacy_prices: z.object({
    drug_name: z.string().min(1),
    zip_code: z.string().optional(),
    recipient_id: recipientIdSchema,
  }).strict(),
  audit_medical_bill: z.object({
    line_items_json: z.string().min(1),
    recipient_id: recipientIdSchema,
  }).strict(),
  check_drug_interactions: z.object({
    medications: z.array(z.string().min(1)),
    recipient_id: recipientIdSchema,
  }).strict(),
  pay_for_medication: z.object({
    pharmacy_id: z.string().min(1),
    pharmacy_name: z.string().min(1),
    drug_name: z.string().min(1),
    amount: amountSchema,
    days_supply: amountSchema.optional(),
    recipient_id: recipientIdSchema,
  }).strict(),
  pay_bill: z.object({
    provider_id: z.string().min(1),
    provider_name: z.string().min(1),
    description: z.string().min(1),
    amount: amountSchema,
    recipient_id: recipientIdSchema,
  }).strict(),
  check_spending_policy: z.object({
    amount: amountSchema,
    category: z.enum(['medications', 'bills']),
    recipient_id: recipientIdSchema,
  }).strict(),
  fetch_rosa_bill: z.object({}).strict(),
  fetch_and_audit_bill: z.object({
    recipient_id: recipientIdSchema,
  }).strict(),
  get_spending_summary: z.object({
    recipient_id: recipientIdSchema,
  }).strict(),
  get_wallet_balance: z.object({}).strict(),
  generate_dispute_letter: z.object({
    bill_id: z.string().min(1),
    audit_result_json: z.string().min(1),
    error_descriptions: z.array(z.string()).optional(),
    recipient_name: z.string().optional(),
    facility: z.string().optional(),
    caregiver_name: z.string().optional(),
    caregiver_email: z.string().optional(),
    recipient_id: recipientIdSchema,
  }).strict(),
  get_adherence_status: z.object({
    recipient_id: recipientIdSchema,
  }).strict(),
  confirm_adherence: z.object({
    record_id: z.string().min(1),
  }).strict(),
} as const;

export function validateToolInput(
  name: string,
  input: unknown,
): Record<string, unknown> {
  const schema = TOOL_INPUT_SCHEMAS[name as keyof typeof TOOL_INPUT_SCHEMAS];
  if (!schema) {
    throw new Error(`Unknown tool: ${name}`);
  }

  const result = schema.safeParse(input ?? {});
  if (result.success) {
    return result.data as Record<string, unknown>;
  }

  const unknownKeys = result.error.issues
    .filter((issue) => issue.code === 'unrecognized_keys')
    .flatMap((issue) => (issue as z.ZodUnrecognizedKeysIssue).keys);
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid tool input for ${name}: unknown field(s) not allowed: ${unknownKeys.join(', ')}`,
    );
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid tool input for ${name}: ${details}`);
}

function strictInputSchema<
  T extends {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  },
>(schema: T): T & { additionalProperties: false } {
  return { ...schema, additionalProperties: false };
}

// Claude API tool definitions
export const TOOL_DEFINITIONS = [
  {
    name: 'compare_pharmacy_prices',
    description:
      'Compare medication prices across multiple pharmacies. Pays $0.002 USDC per query via x402 on Stellar. Returns prices sorted cheapest to most expensive, with potential savings. Each pharmacy has an inStock field: "unknown" means real-time inventory is unavailable (proceed with caution), true means in stock. Never assume a medication is in stock if inStock is "unknown" — confirm with the pharmacy before ordering.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        drug_name: { type: 'string', description: 'Name of the medication (e.g., Lisinopril, Metformin)' },
        zip_code: { type: 'string', description: 'ZIP code for pharmacy location (default: 90210)' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['drug_name'],
    }),
  },
  {
    name: 'audit_medical_bill',
    description:
      'Audit a medical bill for errors (duplicates, upcoding, overcharges). 80% of medical bills contain errors. Pays $0.01 USDC per audit via x402 on Stellar. Pass line_items as a JSON string array of objects with fields: description, cptCode, quantity, chargedAmount.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        line_items_json: {
          type: 'string',
          description: 'JSON string of line items array. Each item: {"description":"...","cptCode":"...","quantity":1,"chargedAmount":100}',
        },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['line_items_json'],
    }),
  },
  {
    name: 'check_drug_interactions',
    description:
      'Check for drug-drug interactions. Pays $0.001 USDC per check via x402 on Stellar. Returns severity levels and clinical recommendations.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        medications: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of medication names',
        },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['medications'],
    }),
  },
  {
    name: 'pay_for_medication',
    description:
      'Pay a pharmacy for a medication order via MPP Charge on Stellar (real USDC payment). Subject to spending policy limits.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        pharmacy_id: { type: 'string' },
        pharmacy_name: { type: 'string' },
        drug_name: { type: 'string' },
        amount: { type: 'number' },
        days_supply: { type: 'number', description: 'Days supply for adherence tracking (default: 30)' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['pharmacy_id', 'pharmacy_name', 'drug_name', 'amount'],
    }),
  },
  {
    name: 'pay_bill',
    description:
      'Pay a medical bill via direct Stellar USDC transfer. Subject to spending policy limits. If the bill has been audited and errors found, pay only the corrected amount.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        provider_id: { type: 'string' },
        provider_name: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['provider_id', 'provider_name', 'description', 'amount'],
    }),
  },
  {
    name: 'check_spending_policy',
    description:
      'Check if a payment amount is within the caregiver-set spending policy limits before attempting payment.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        amount: { type: 'number' },
        category: { type: 'string', enum: ['medications', 'bills'] },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['amount', 'category'],
    }),
  },
  {
    name: 'fetch_rosa_bill',
    description:
      "Fetch the current care recipient's hospital bill. Returns the bill with line items including CPT codes and charged amounts.",
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    }),
  },
  {
    name: 'fetch_and_audit_bill',
    description:
      "Fetch the care recipient's hospital bill AND audit it for errors in one step. Pays $0.01 USDC via x402. Returns the audit results with errors found, overcharges, and corrected total. Use this instead of calling fetch_bill + audit_medical_bill separately.",
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: [] as string[],
    }),
  },
  {
    name: 'get_spending_summary',
    description:
      'Get current spending summary: total spent, budget remaining per category, recent transactions with Stellar tx hashes for the current care recipient.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: [] as string[],
    }),
  },
  {
    name: 'get_wallet_balance',
    description:
      'Get the current on-chain wallet balance (USDC and XLM) from Stellar Horizon. Returns real-time balance data. If usdcTrustlineMissing is true, the agent wallet lacks a USDC trustline — instruct the caregiver to fund the wallet at https://faucet.circle.com.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    }),
  },
  {
    name: 'generate_dispute_letter',
    description:
      'Generate a dispute letter PDF and email body for a billing error. Use after audit finds overcharges. Letter includes audit findings, CPT codes, fair-market rates, and caregiver contact info.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        bill_id: { type: 'string', description: 'The disputed bill ID' },
        audit_result_json: { type: 'string', description: 'JSON string of the full audit result from audit_medical_bill' },
        error_descriptions: { type: 'array', items: { type: 'string' }, description: 'List of error descriptions to include (empty = all errors)' },
        recipient_name: { type: 'string', description: 'Recipient/patient name' },
        facility: { type: 'string', description: 'Healthcare facility/hospital name' },
        caregiver_name: { type: 'string', description: 'Caregiver name for signature' },
        caregiver_email: { type: 'string', description: 'Caregiver email for signature' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['bill_id', 'audit_result_json'],
    }),
  },
  {
    name: 'get_adherence_status',
    description:
      'Get medication adherence status for a recipient — pending reminders, confirmed doses, skipped doses, and flagged persistent skips.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        recipient_id: { type: 'string', description: 'Recipient identifier (default: rosa)' },
      },
      required: [] as string[],
    }),
  },
  {
    name: 'confirm_adherence',
    description:
      'Confirm that a medication dose was taken. Call this when the caregiver reports the recipient took their medication.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        record_id: { type: 'string', description: 'Adherence record ID to confirm' },
      },
      required: ['record_id'],
    }),
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
