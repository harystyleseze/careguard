/**
 * CareGuard Agent Tools — Real payment integrations on Stellar testnet
 *
 * Supports multiple care recipients via per-recipient data directories.
 *   data/recipients/<recipientId>/spending.json        (legacy, kept for compat)
 *   data/recipients/<recipientId>/transactions.jsonl   (append-only log, one JSON line per tx)
 *   data/recipients/<recipientId>/spending.snapshot.json (compacted every 100 transactions)
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
 *
 * Persistence strategy (Issue #205):
 *   - New transactions are appended as single JSON lines to transactions.jsonl.
 *   - Every SNAPSHOT_INTERVAL (100) transactions the full tracker state is
 *     compacted into spending.snapshot.json via an atomic rename.
 *   - On read: load the snapshot, then replay only the tail of the JSONL that
 *     was appended after the last compaction.
 *   - spending.json is still written on full saves for backward compatibility
 *     with any tooling that reads it directly.
 */

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, promises as fsPromises } from 'fs';
import { z } from 'zod';
import { logger } from '../shared/logger.ts';
import { resolveStellarNetwork, validateSignerKeyForNetwork } from '../shared/stellar-network.ts';
import {
  BillAuditValidationError,
  validateLineItems,
  type LineItem,
} from '../shared/bill-audit.ts';
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
import {
  STELLAR_TX_HASH_RE,
  TRANSACTION_CATEGORY,
  isTransactionCategory,
  normalizeTransactionCategory,
  type SpendingPolicy,
  type Transaction,
} from '../shared/types.ts';
import { SPENDING_TIMEZONE, getLocalDateStr, getLocalDayBounds } from './tz.ts';
export { SPENDING_TIMEZONE, getLocalDateStr, getLocalDayBounds };
import { appendAuditEntry } from '../shared/audit-log.ts';
import { notify } from '../shared/notifications.ts';
import {
  getAdherenceSummary,
  getPendingAdherences,
  getFlaggedAdherences,
  confirmAdherence,
} from '../shared/adherence.ts';
import { Journal } from './journal.ts';
import {
  x402SettlementsTotal,
  paymentsUsdcTotal,
  stellarTxSubmittedTotal,
  policyBlocksTotal,
  paymentRejectedTotal,
  agentSpendingUsd,
  agentTransactionsTotal,
  x402TxExtractionFailedTotal,
} from '../shared/metrics.ts';
import {
  assertMockNetworkAllowed,
  createMockReceipt,
  isMockNetwork,
} from '../shared/network-mode.ts';

assertMockNetworkAllowed();

// Atomic file write helpers (Issues #203, #204)
function writeAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (err) {
    try { writeFileSync(filePath.slice(0, filePath.lastIndexOf('/')), '', 'utf-8'); } catch {}
    throw err;
  }
}

function rotateCorruptedFile(filePath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rotatedPath = `${filePath}.corrupt-${timestamp}`;
  try {
    renameSync(filePath, rotatedPath);
    logger.error({ filePath, rotatedPath }, '[Persistence] Rotated corrupted file');
  } catch (err) {
    logger.error({ filePath, err }, '[Persistence] Failed to rotate corrupted file');
  }
  return rotatedPath;
}

// Resolve Stellar network configuration
const STELLAR_CONFIG = resolveStellarNetwork();
const STELLAR_NETWORK_PASSPHRASE = STELLAR_CONFIG.networkPassphrase;
const HORIZON_URL = STELLAR_CONFIG.horizonUrl;

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

// On public network, USDC_ISSUER must be explicitly set.
// Falling back to the testnet issuer on mainnet causes silent incorrect balance reads
// (the issuer address is different on each network). See docs/security/asset-spoofing.md.
if (STELLAR_CONFIG.networkType === 'public' && !process.env.USDC_ISSUER) {
  throw new Error(
    'USDC_ISSUER env var must be explicitly set when STELLAR_NETWORK=public. ' +
    'Set it to the Circle USDC issuer for Stellar mainnet.',
  );
}

const MIN_FEE_STROOPS = 100;
const MAX_FEE_STROOPS = parseInt(process.env.MAX_FEE_STROOPS || '100000');
const STELLAR_TIMEBOUNDS_SECONDS = parseInt(process.env.STELLAR_TIMEBOUNDS_SECONDS || "60", 10);

if (!AGENT_SECRET_KEY) throw new Error('AGENT_SECRET_KEY required in .env');

const agentKeypair = Keypair.fromSecret(AGENT_SECRET_KEY);

// Validate signer key matches configured network
validateSignerKeyForNetwork(AGENT_SECRET_KEY, STELLAR_CONFIG);

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

export const TX_HASH_EXTRACTION_FAILED = 'extraction_failed' as const;

// Helper: extract real Stellar tx hash from x402 PAYMENT-RESPONSE header.
// Returns undefined when no header is present, TX_HASH_EXTRACTION_FAILED when
// the header is present but all decode strategies fail (logged + counted), or
// a 64-char hex hash on success. Callers must check for the sentinel before
// passing the result to waitForStellarSettlement (#191).
export function extractX402TxHash(
  response: Response,
): string | typeof TX_HASH_EXTRACTION_FAILED | undefined {
  const header =
    response.headers.get('PAYMENT-RESPONSE') ||
    response.headers.get('payment-response') ||
    response.headers.get('X-PAYMENT-RESPONSE');
  if (!header) return undefined;

  // Strategy 1: decode the structured payment-response header
  try {
    const decoded = decodePaymentResponseHeader(header);
    if (decoded.transaction) return decoded.transaction;
  } catch {
    // fall through to strategy 2
  }

  // Strategy 2: the header itself might be a raw 64-char hex hash
  if (STELLAR_TX_HASH_RE.test(header)) return header;

  // All strategies failed — log full header for debugging and count the event
  logger.warn(
    { paymentResponseHeader: header.slice(0, 500) },
    '[x402] extractX402TxHash: all extraction strategies failed; hash unverifiable on-chain',
  );
  x402TxExtractionFailedTotal.inc();
  return TX_HASH_EXTRACTION_FAILED;
}

// Helper: submitTransaction with timeout and retry
async function submitTransactionWithRetry(
  server: Horizon.Server,
  tx: any,
  maxRetries = 2,
  timeoutMs = 35000,
  rebuildTx?: () => Promise<any>
): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await server.submitTransaction(tx, { timeout: timeoutMs } as any);
      return result;
    } catch (err: any) {
      lastError = err;
      if (err?.response?.status) throw err;
      const msg = err?.message ?? "";
      // tx_too_late: timebounds expired — retry once with fresh timebounds if rebuild fn provided
      if (msg.includes("tx_too_late") && rebuildTx && attempt < maxRetries) {
        logger.warn({ attempt: attempt + 1 }, "[Stellar] tx_too_late, rebuilding with fresh timebounds");
        tx = await rebuildTx();
        continue;
      }
      if (msg.includes("tx_bad_seq") || msg.includes("tx_too_early") || msg.includes("tx_too_late")) throw err;
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
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
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
// Use stellar:testnet or stellar:public scheme based on STELLAR_NETWORK env.
// getSigner() re-reads AGENT_SECRET_KEY on a 60s TTL so the key can be rotated
// without a full process restart. SIGHUP triggers immediate cache invalidation
// (zero-downtime reload). See docs/runbooks/rotate-agent-key.md.
const x402SchemeId = `stellar:${STELLAR_CONFIG.networkType}` as `${string}:${string}`;
export const X402_SIGNER_TTL_MS = 60_000;
let _x402Fetch: typeof fetch | null = null;
let _x402FetchCreatedAt = 0;

export function getX402Fetch(): typeof fetch {
  if (isMockNetwork()) return fetch;
  const now = Date.now();
  if (!_x402Fetch || now - _x402FetchCreatedAt > X402_SIGNER_TTL_MS) {
    const key = process.env.AGENT_SECRET_KEY;
    if (!key) throw new Error('AGENT_SECRET_KEY required');
    _x402Fetch = wrapFetchWithPayment(
      fetch,
      new x402Client().register(
        x402SchemeId,
        new ExactStellarScheme(createEd25519Signer(key, x402SchemeId)),
      ),
    );
    _x402FetchCreatedAt = now;
  }
  return _x402Fetch;
}

process.on('SIGHUP', () => {
  _x402Fetch = null;
  _x402FetchCreatedAt = 0;
  logger.info('[x402] SIGHUP received — signer cache invalidated, will reload on next call');
});

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
const DATA_DIR = process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url));
export function getDataDir(): string {
  return process.env.DATA_DIR || new URL('../data', import.meta.url).pathname;
}

let currentRecipientId = 'rosa';

const DEFAULT_POLICY: SpendingPolicy = {
  dailyLimit: 100,
  monthlyLimit: 800,
  medicationMonthlyBudget: 300,
  billMonthlyBudget: 500,
  approvalThreshold: 75,
  holdTimeSeconds: 0,
  toolFees: {
    comparePharmacyPrices: 0.002,
    auditBill: 0.01,
    checkDrugInteractions: 0.001,
  },
  notifications: { email: false, sms: false },
};

// Helper: Get tool fee from policy, throw if not configured
function getToolFee(toolName: string): number {
  const policy = loadPolicy();
  const fee = policy.toolFees?.[toolName];
  if (fee === undefined || fee === null) {
    throw new Error(
      `Tool fee not configured for ${toolName}. Please add it to policy.toolFees in the spending policy.`,
    );
  }
  return fee;
}

export function setCurrentRecipient(recipientId: string) {
  currentRecipientId = recipientId;
  const dir = getRecipientDir(recipientId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  spendingTracker = loadSpending(recipientId);
  currentPolicy = loadPolicy(recipientId);
}
export function getCurrentRecipient() { return currentRecipientId; }

function getRecipientDir(recipientId: string): string {
  return `${getDataDir()}/recipients/${recipientId}`;
}
function getSpendingFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/spending.json`;
}
/** Append-only JSONL log — one line per transaction (Issue #205). */
function getTransactionLogFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/transactions.jsonl`;
}
/** Periodic compaction snapshot written every SNAPSHOT_INTERVAL transactions (Issue #205). */
function getSnapshotFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/spending.snapshot.json`;
}
function getPolicyFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/policy.json`;
}
function getOrdersFile(recipientId?: string): string {
  return `${getRecipientDir(recipientId || currentRecipientId)}/orders.json`;
}

// Migrate legacy flat files to per-recipient structure (one-time)
function migrateLegacyData() {
  const legacySpending = `${getDataDir()}/spending.json`;
  const legacyOrders = `${getDataDir()}/orders.json`;
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

if (!existsSync(getDataDir())) mkdirSync(getDataDir(), { recursive: true });
if (!existsSync(getRecipientDir(currentRecipientId))) mkdirSync(getRecipientDir(currentRecipientId), { recursive: true });

interface SpendingTracker {
  medications: number;
  bills: number;
  serviceFees: number;
  transactions: Transaction[];
}

const SpendingTrackerSchema = z.object({
  medications: z.number(),
  bills: z.number(),
  serviceFees: z.number(),
  // Accept both the legacy Transaction shape (timestamp/type/recipient/status)
  // and the upstream shape (createdAt/metadata). normalizeTransactionCategories
  // casts entries to Transaction after loading, so loose validation is intentional.
  transactions: z.array(z.record(z.unknown())),
});

type PaymentCategory =
  | typeof TRANSACTION_CATEGORY.MEDICATIONS
  | typeof TRANSACTION_CATEGORY.BILLS;

// Zod schema for spending policy — enforces positive values, sane upper bounds,
// and cross-field ordering. holdTimeSeconds uses .min(0) because DEFAULT_POLICY sets it to 0.
export const SpendingPolicySchema = z.object({
  dailyLimit: z.number().gt(0, 'dailyLimit must be greater than 0').max(10_000, 'dailyLimit cannot exceed $10,000'),
  monthlyLimit: z.number().gt(0, 'monthlyLimit must be greater than 0').max(100_000, 'monthlyLimit cannot exceed $100,000'),
  medicationMonthlyBudget: z.number().gt(0, 'medicationMonthlyBudget must be greater than 0').max(50_000, 'medicationMonthlyBudget cannot exceed $50,000'),
  billMonthlyBudget: z.number().gt(0, 'billMonthlyBudget must be greater than 0').max(50_000, 'billMonthlyBudget cannot exceed $50,000'),
  approvalThreshold: z.number().gt(0, 'approvalThreshold must be greater than 0').max(10_000, 'approvalThreshold cannot exceed $10,000'),
  holdTimeSeconds: z.number().min(0).max(86_400).default(0),
  timezone: z.string().optional(),
  toolFees: z.record(z.number().min(0)).optional(),
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    emailAddress: z.string().email().optional(),
    phoneNumber: z.string().optional(),
  }).optional(),
}).refine(
  (p) => p.dailyLimit <= p.monthlyLimit,
  { message: 'dailyLimit cannot exceed monthlyLimit', path: ['dailyLimit'] },
).refine(
  (p) => p.approvalThreshold <= p.dailyLimit,
  { message: 'approvalThreshold cannot exceed dailyLimit', path: ['approvalThreshold'] },
).refine(
  (p) => p.medicationMonthlyBudget + p.billMonthlyBudget <= p.monthlyLimit,
  { message: 'medicationMonthlyBudget + billMonthlyBudget cannot exceed monthlyLimit', path: ['medicationMonthlyBudget'] },
);

type SpendingPolicyInput = z.infer<typeof SpendingPolicySchema>;

const SPENDING_CACHE_TTL_MS = 5000;
/** Compact the JSONL log into a snapshot every this many transactions (Issue #205). */
export const SNAPSHOT_INTERVAL = 100;

type SpendingCacheEntry = {
  data: SpendingTracker;
  loadedAt: number;
};

const spendingCache = new Map<string, SpendingCacheEntry>();

function createEmptySpendingTracker(): SpendingTracker {
  return { medications: 0, bills: 0, serviceFees: 0, transactions: [] };
}

function normalizeTransactionCategories(
  data: SpendingTracker,
  recipientId?: string,
): { data: SpendingTracker; migrated: boolean } {
  let migrated = false;
  const transactions = (data.transactions || []).map((tx: any) => {
    if (isTransactionCategory(tx.category)) return tx as Transaction;

    migrated = true;
    const previousCategory = tx.category;
    const normalizedTx = {
      ...tx,
      category: normalizeTransactionCategory(tx.category),
    } as Transaction;
    appendAuditEntry({
      event: 'transaction.category_migrated',
      actor: 'system',
      details: {
        recipientId: recipientId || currentRecipientId,
        transactionId: tx.id,
        previousCategory,
        currentCategory: TRANSACTION_CATEGORY.SERVICE_FEES,
      },
    });
    return normalizedTx;
  });

  return {
    data: { ...data, transactions },
    migrated,
  };
}

/**
 * Read spending state from disk using the snapshot + JSONL tail strategy (Issue #205).
 *
 * Load order:
 *  1. spending.snapshot.json  — compacted base state
 *  2. transactions.jsonl tail — lines appended after the snapshot was written
 *  3. spending.json fallback   — legacy full-file for backward compatibility
 */
function readSpendingFromDisk(recipientId?: string): SpendingTracker {
  const snapshotFile = getSnapshotFile(recipientId);
  const logFile = getTransactionLogFile(recipientId);
  const legacyFile = getSpendingFile(recipientId);

  // --- Try new snapshot + JSONL tail path first ---
  if (existsSync(snapshotFile)) {
    try {
      const raw = readFileSync(snapshotFile, 'utf-8');
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch (parseErr) {
        logger.warn({ file: snapshotFile }, '[Persistence] JSON parse failed on snapshot');
        rotateCorruptedFile(snapshotFile);
        throw parseErr;
      }

      const validated = SpendingTrackerSchema.safeParse(parsed);
      if (!validated.success) {
        logger.warn({ file: snapshotFile, errors: validated.error.errors }, '[Persistence] Snapshot schema invalid');
        rotateCorruptedFile(snapshotFile);
        throw new Error('Snapshot schema validation failed');
      }

      const snapshot = validated.data as unknown as SpendingTracker & { _snapshotTxCount?: number };
      const snapshotTxCount = (parsed as any)._snapshotTxCount ?? snapshot.transactions.length;

      // Replay transactions from the JSONL tail that came after the snapshot
      const tailTxs: Transaction[] = [];
      if (existsSync(logFile)) {
        const raw = readFileSync(logFile, 'utf-8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0);
        // Skip the lines already captured in the snapshot
        for (let i = snapshotTxCount; i < lines.length; i++) {
          try {
            tailTxs.push(JSON.parse(lines[i]) as Transaction);
          } catch {
            logger.warn({ line: i }, '[Persistence] Skipping malformed JSONL line');
          }
        }
      }

      const merged: SpendingTracker = {
        medications: snapshot.medications,
        bills: snapshot.bills,
        serviceFees: snapshot.serviceFees,
        transactions: [...snapshot.transactions, ...tailTxs],
      };
      const normalized = normalizeTransactionCategories(merged, recipientId);
      if (normalized.migrated) {
        saveSpending(normalized.data, recipientId);
      }
      return normalized.data;
    } catch (err: any) {
      logger.warn(
        { file: snapshotFile, error: err.message },
        '[Persistence] spending.snapshot.json is corrupted; falling back to legacy file',
      );
    }
  }

  // --- Legacy fallback: spending.json (full JSON blob) ---
  if (!existsSync(legacyFile)) return createEmptySpendingTracker();
  try {
    const raw = readFileSync(legacyFile, 'utf-8');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (parseErr) {
      logger.error({ file: legacyFile }, '[Persistence] JSON parse failed on spending.json');
      const rotated = rotateCorruptedFile(legacyFile);
      logger.error({ rotatedPath: rotated }, '[Persistence] CRITICAL: Corrupted spending file rotated, starting fresh');
      return createEmptySpendingTracker();
    }

    const validated = SpendingTrackerSchema.safeParse(parsed);
    if (!validated.success) {
      logger.error({ file: legacyFile, errors: validated.error.errors }, '[Persistence] spending.json schema invalid');
      const rotated = rotateCorruptedFile(legacyFile);
      logger.error({ rotatedPath: rotated }, '[Persistence] CRITICAL: Invalid spending schema, starting fresh');
      return createEmptySpendingTracker();
    }

    const normalized = normalizeTransactionCategories(validated.data as unknown as SpendingTracker, recipientId);
    if (normalized.migrated) {
      saveSpending(normalized.data, recipientId);
    }
    return normalized.data;
  } catch (err: any) {
    logger.error(
      { file: legacyFile, error: err.message },
      '[Persistence] CRITICAL: Unexpected error loading spending.json',
    );
    return createEmptySpendingTracker();
  }
}

export function loadSpending(recipientId?: string): SpendingTracker {
  const resolvedRecipientId = recipientId || currentRecipientId;
  const cached = spendingCache.get(resolvedRecipientId);
  const now = Date.now();

  if (cached && now - cached.loadedAt < SPENDING_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = readSpendingFromDisk(resolvedRecipientId);
  spendingCache.set(resolvedRecipientId, { data, loadedAt: now });
  return data;
}

/**
 * Append a single transaction as one JSON line to transactions.jsonl (Issue #205).
 * This is O(1) per call — no full-file rewrite.
 * Also triggers compaction every SNAPSHOT_INTERVAL transactions.
 */
export function appendTransaction(tx: Transaction, recipientId?: string): void {
  const logFile = getTransactionLogFile(recipientId);
  appendFileSync(logFile, JSON.stringify(tx) + '\n', 'utf-8');

  // Compact into a snapshot every SNAPSHOT_INTERVAL transactions
  const totalTxs = spendingTracker.transactions.length;
  if (totalTxs > 0 && totalTxs % SNAPSHOT_INTERVAL === 0) {
    compactSnapshot(spendingTracker, recipientId);
  }
}

/**
 * Write a periodic compaction snapshot so the JSONL tail stays short (Issue #205).
 * Uses an atomic rename to avoid partial writes.
 */
export function compactSnapshot(data: SpendingTracker, recipientId?: string): void {
  const snapshotFile = getSnapshotFile(recipientId);
  const payload = {
    ...data,
    // Record how many JSONL lines this snapshot covers so the read path
    // knows where the tail starts.
    _snapshotTxCount: data.transactions.length,
  };
  writeAtomically(snapshotFile, JSON.stringify(payload, null, 2));
  logger.info(
    { txCount: data.transactions.length, recipientId: recipientId || currentRecipientId },
    '[Persistence] Compacted spending snapshot',
  );
}

/**
 * Full save: writes the legacy spending.json for backward compatibility and
 * also seeds the snapshot + JSONL files if they don't exist yet (Issue #205).
 */
export function saveSpending(data: SpendingTracker, recipientId?: string) {
  // 1. Legacy full-file (backward compat for external tooling)
  const file = getSpendingFile(recipientId);
  writeAtomically(file, JSON.stringify(data, null, 2));

  // 2. Write / refresh the snapshot file so the new read path can find state
  compactSnapshot(data, recipientId);

  // 3. Seed the JSONL log with all current transactions if it doesn't exist
  const logFile = getTransactionLogFile(recipientId);
  if (!existsSync(logFile)) {
    const lines = data.transactions.map((tx) => JSON.stringify(tx)).join('\n');
    writeFileSync(logFile, lines.length > 0 ? lines + '\n' : '', 'utf-8');
  }

  spendingCache.set(recipientId || currentRecipientId, {
    data,
    loadedAt: Date.now(),
  });
}

let spendingTracker = loadSpending();

// --- Budget mutex (Issue #209) ---
// Consistency model: per-process, per-recipient.
//   Within a single Node.js process the mutex makes the check-and-reserve step
//   atomic: no two concurrent payForMedication / payBill calls can both pass the
//   budget check when only one slot remains.
// Cross-process: if you run multiple server replicas sharing the same data
//   directory, wrap the spending file read-modify-write with proper-lockfile
//   (already a dependency) instead of this in-memory mutex.
class AsyncMutex {
  private _locked = false;
  private _queue: Array<() => void> = [];

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this._queue.shift();
        if (next) next();
        else this._locked = false;
      };
      if (this._locked) {
        this._queue.push(() => resolve(release));
      } else {
        this._locked = true;
        resolve(release);
      }
    });
  }
}

const _budgetMutexes = new Map<string, AsyncMutex>();
function getBudgetMutex(recipientId: string): AsyncMutex {
  let m = _budgetMutexes.get(recipientId);
  if (!m) { m = new AsyncMutex(); _budgetMutexes.set(recipientId, m); }
  return m;
}

const MAX_PAYMENT = 1000;
// Platform-level single-transaction cap (issue #83). Sits above the caregiver policy's
// approvalThreshold so a compromised session cannot bypass it. Only changeable by redeploying.
// Read on every call so tests can override process.env.MAX_SINGLE_TX_USDC between runs.
function getPlatformTxCap(): number {
  return parseFloat(process.env.MAX_SINGLE_TX_USDC ?? '100');
}

// Budget values are rounded to 4 decimal places to eliminate float underflow (issue #287).
// 4 dp = sub-cent precision; values within 0.5/BUDGET_SCALE of zero collapse cleanly to zero.
const BUDGET_SCALE = 10_000;
function roundBudget(v: number): number {
  return Math.round(v * BUDGET_SCALE) / BUDGET_SCALE;
}

const MAX_ERROR_LENGTH = 500;

function truncateError(message: string): string {
  return message.replace(/<[^>]*>/g, '').slice(0, MAX_ERROR_LENGTH);
}

function recordServiceFee(
  amount: number,
  description: string,
  recipient: string,
  stellarTxHash?: string,
  txHashStatus?: 'extracted' | 'extraction_failed',
) {
  x402SettlementsTotal.inc();
  spendingTracker.serviceFees += amount;
  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'service_fee',
    description,
    amount,
    recipient,
    stellarTxHash,
    txHashStatus,
    status: 'completed',
    category: TRANSACTION_CATEGORY.SERVICE_FEES,
  };
  spendingTracker.transactions.push(tx);
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: TRANSACTION_CATEGORY.SERVICE_FEES },
    spendingTracker.serviceFees,
  );
  // Append the single transaction — O(1) — instead of rewriting the whole file
  appendTransaction(tx);
}

function loadPolicy(recipientId?: string): SpendingPolicy {
  const file = getPolicyFile(recipientId);
  if (!existsSync(file)) return { ...DEFAULT_POLICY };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err: any) {
    logger.warn(
      { file, error: err.message },
      '[Persistence] policy.json is corrupted; falling back to the default policy',
    );
    return { ...DEFAULT_POLICY };
  }
}

function savePolicy(policy: SpendingPolicy, recipientId?: string) {
  writeFileSync(getPolicyFile(recipientId), JSON.stringify(policy, null, 2));
}

function assertValidSpendingPolicy(policy: SpendingPolicy) {
  SpendingPolicySchema.parse(policy);
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
  assertValidSpendingPolicy(normalizedPolicy);
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
  // Return the latest disk-backed policy rather than the potentially stale
  // module-level `currentPolicy` so multi-instance deployments observe
  // updates made via the caregiver HTTP API.
  const policy = loadPolicy();
  return { ...spendingTracker, policy };
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
  dosage: string = 'unspecified',
) {
  const url = `${PHARMACY_API}/pharmacy/compare?drug=${encodeURIComponent(drugName)}&dosage=${encodeURIComponent(dosage)}&zip=${encodeURIComponent(zipCode)}`;
  const fee = getToolFee('comparePharmacyPrices');
  logger.info({ drug: drugName, fee }, '[x402] paying for pharmacy price query');

  if (isMockNetwork()) {
    const receipt = createMockReceipt('x402:pharmacy-prices', {
      drugName,
      zipCode,
    });
    const data = {
      drug: drugName,
      dosage,
      zipCode,
      protocol: {
        name: 'x402',
        mockNetwork: true,
        price: `$${fee.toFixed(3)}`,
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
      fee,
      `x402 query: pharmacy prices for ${drugName}`,
      'mock-pharmacy-price-api',
      receipt.stellarTxHash,
    );
    return data;
  }

  const response = await getX402Fetch()(url);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Pharmacy API error (${response.status}): ${truncateError(error)}`,
    );
  }

  const data = await response.json();

  // Extract real Stellar tx hash from x402 payment response header
  const txHashResult = extractX402TxHash(response);
  const txHash = txHashResult === TX_HASH_EXTRACTION_FAILED ? undefined : txHashResult;
  const txHashStatus = txHashResult === TX_HASH_EXTRACTION_FAILED
    ? 'extraction_failed' as const
    : txHash ? 'extracted' as const : undefined;

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
    fee,
    `x402 query: pharmacy prices for ${drugName}`,
    data.protocol?.payTo || 'pharmacy-price-api',
    txHash,
    txHashStatus,
  );

  return data;
}

// --- Tool: Fetch Rosa's hospital bill (free endpoint, no x402 payment) ---
export async function fetchRosaBill(recipientId?: string) {
  const rid = recipientId ?? currentRecipientId;
  logger.info({ recipientId: rid }, '[fetch] getting care recipient bill');

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

  const url = new URL(`${BILL_AUDIT_API}/bill/sample`);
  if (rid) url.searchParams.set('recipientId', rid);
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Failed to fetch bill (${response.status}): service may be starting up. Try again in a moment.`,
    );
  }

  return await response.json();
}

// --- Tool: Fetch care recipient's bill AND audit it in one step (pays via x402) ---
export async function fetchAndAuditBill(recipientId?: string) {
  const rid = recipientId ?? currentRecipientId;
  logger.info({ recipientId: rid }, "[fetch+audit] getting care recipient bill and auditing it");

  // Step 1: Fetch the bill (free)
  const bill = await fetchRosaBill(rid);

  // Step 2: Audit it (pays via x402)
  return await auditBill(bill.lineItems);
}

// --- Tool: Audit a medical bill (pays via x402) ---
export async function auditBill(
  lineItemsInput: unknown,
) {
  let lineItems: LineItem[];
  try {
    lineItems = validateLineItems(lineItemsInput);
  } catch (error) {
    if (error instanceof BillAuditValidationError) {
      return {
        ok: false,
        reason: error.code,
        message: error.message,
        issues: error.issues,
      };
    }
    throw error;
  }

  const fee = getToolFee('auditBill');
  logger.info(
    { lineItemCount: lineItems.length, fee },
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
        price: `$${fee.toFixed(2)}`,
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
      fee,
      'x402 query: medical bill audit',
      'mock-bill-audit-api',
      receipt.stellarTxHash,
    );
    return data;
  }

  let response: Response;
  try {
    response = await getX402Fetch()(`${BILL_AUDIT_API}/bill/audit`, {
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

  const txHashResult = extractX402TxHash(response);
  const txHash = txHashResult === TX_HASH_EXTRACTION_FAILED ? undefined : txHashResult;
  const txHashStatus = txHashResult === TX_HASH_EXTRACTION_FAILED
    ? 'extraction_failed' as const
    : txHash ? 'extracted' as const : undefined;

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
    txHashStatus,
  );

  return data;
}

// --- Tool: Check drug interactions (pays via x402) ---
export async function checkDrugInteractions(medications: string[]) {
  if (medications.length < 2) {
    return {
      ok: false,
      reason: 'NEED_AT_LEAST_TWO_MEDS',
      message: 'Drug interaction checks require at least 2 medications.',
      receivedMedications: medications.length,
      requiredMedications: 2,
    };
  }

  const medsParam = medications.join(',');
  const fee = getToolFee('checkDrugInteractions');
  logger.info(
    { medicationCount: medications.length, fee },
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
        price: `$${fee.toFixed(3)}`,
        payTo: 'mock-drug-interaction-api',
        receipt,
      },
      interactions: [],
      summary: 'Mock network interaction check completed. No interactions detected.',
    };
    recordServiceFee(
      fee,
      `x402 query: drug interactions for ${medications.join(', ')}`,
      'mock-drug-interaction-api',
      receipt.stellarTxHash,
    );
    return data;
  }

  const response = await getX402Fetch()(
    `${DRUG_INTERACTION_API}/drug/interactions?meds=${encodeURIComponent(
      medications.join(','),
    )}`,
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Drug Interaction API error (${response.status}): ${truncateError(error)}`,
    );
  }

  const data = await response.json();

  const txHashResult = extractX402TxHash(response);
  const txHash = txHashResult === TX_HASH_EXTRACTION_FAILED ? undefined : txHashResult;
  const txHashStatus = txHashResult === TX_HASH_EXTRACTION_FAILED
    ? 'extraction_failed' as const
    : txHash ? 'extracted' as const : undefined;

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
    fee,
    `x402 query: drug interactions for ${medications.join(', ')}`,
    data.protocol?.payTo || 'drug-interaction-api',
    txHash,
    txHashStatus,
  );

  return data;
}

// --- Tool: Check spending policy ---
export function checkSpendingPolicy(
  amount: number,
  category: PaymentCategory,
) {
  // Always load the latest policy from disk so multi-instance deployments
  // pick up caregiver updates performed via POST /agent/policy.
  const policy = loadPolicy();
  const budget =
    category === TRANSACTION_CATEGORY.MEDICATIONS
      ? policy.medicationMonthlyBudget
      : policy.billMonthlyBudget;
  const currentSpending =
    category === TRANSACTION_CATEGORY.MEDICATIONS
      ? spendingTracker.medications
      : spendingTracker.bills;
  const remaining = roundBudget(budget - currentSpending);
  const totalMonthlySpending =
    spendingTracker.medications +
    spendingTracker.bills +
    spendingTracker.serviceFees;
  const globalRemaining = roundBudget(policy.monthlyLimit - totalMonthlySpending);

  // Compute today's spend in this category up-front so every return path can
  // report the remaining daily budget to the caller (Issue #160). Use the
  // policy's per-recipient timezone if set; fall back to the global
  // SPENDING_TIMEZONE env var so caregivers in non-UTC locales see the correct
  // "today" boundary for their wall clock (Issue #207).
  const effectiveTz = policy.timezone ?? SPENDING_TIMEZONE;
  const { dayStart, dayEnd } = getLocalDayBounds(effectiveTz);
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  const totalToday = spendingTracker.transactions
    .filter(
      (t) => {
        const txTimestamp = new Date(t.timestamp).getTime();
        return (
          Number.isFinite(txTimestamp) &&
          txTimestamp >= dayStartMs &&
          txTimestamp < dayEndMs &&
          t.category === category
        );
      },
    )
    .reduce((sum, t) => sum + t.amount, 0);
  const dailyRemaining = roundBudget(policy.dailyLimit - totalToday);
  // monthlyRemaining is the budget still available for this category this month.
  const monthlyRemaining = remaining;

  if (amount > globalRemaining) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} would exceed overall monthly limit. Monthly limit: $${policy.monthlyLimit}, spent: $${totalMonthlySpending.toFixed(2)}, remaining: $${globalRemaining.toFixed(2)}`,
      requiresApproval: false,
      currentSpending,
      budgetRemaining: remaining,
      globalBudgetRemaining: globalRemaining,
      dailyRemaining,
      monthlyRemaining,
    };
  }

  if (amount > remaining) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} exceeds ${category} monthly budget. Budget: $${budget}, spent: $${currentSpending.toFixed(2)}, remaining: $${remaining.toFixed(2)}`,
      requiresApproval: false,
      currentSpending,
      budgetRemaining: remaining,
      dailyRemaining,
      monthlyRemaining,
    };
  }

  if (totalToday + amount > policy.dailyLimit) {
    return {
      allowed: false,
      reason: `Payment of $${amount.toFixed(2)} would exceed daily limit of $${policy.dailyLimit}. Already spent today: $${totalToday.toFixed(2)}`,
      requiresApproval: false,
      currentSpending,
      budgetRemaining: remaining,
      dailyRemaining,
      monthlyRemaining,
    };
  }

  return {
    allowed: true,
    requiresApproval: amount >= policy.approvalThreshold,
    currentSpending,
    budgetRemaining: roundBudget(remaining - amount),
    dailyRemaining,
    monthlyRemaining,
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

    // Prefer an explicit receipt provided in the HTTP response headers
    // (Payment-Receipt) or in the JSON body. Do NOT rely on a module-level
    // `lastTxHash` value because parallel payments can race and overwrite
    // that shared state.
    const receiptHeader =
      response.headers.get('Payment-Receipt') || response.headers.get('payment-receipt');
    if (receiptHeader) {
      try {
        const receipt = JSON.parse(Buffer.from(receiptHeader, 'base64').toString());
        stellarTxHash = receipt.reference || receipt.hash || receipt.transaction || receipt.stellarTxHash;
      } catch {
        // If header is not base64 JSON, treat it as a raw hash
        stellarTxHash = receiptHeader;
      }
    }

    // Fallbacks from body
    if (!stellarTxHash && data.receipt) {
      stellarTxHash = data.receipt.stellarTxHash || data.receipt.reference || data.receipt.hash || data.receipt.transaction;
    }
    if (!stellarTxHash && data.order && data.order.receipt) {
      stellarTxHash = data.order.receipt;
    }

    mppOrderId = data.order?.id;
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    return { success: false, error: `MPP payment failed: ${err.message}` };
  }

  // Standardize on a real 64-char hex hash or undefined (#14) — never an
  // un-decodable receipt blob — so downstream consumers (e.g. TxLink) don't
  // need to guess at the shape of this field.
  if (stellarTxHash && !STELLAR_TX_HASH_RE.test(stellarTxHash)) {
    logger.warn(
      { receivedValue: stellarTxHash },
      '[MPP] payment succeeded but receipt did not contain a valid Stellar tx hash',
    );
    stellarTxHash = undefined;
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
    if (tx.category === TRANSACTION_CATEGORY.MEDICATIONS) {
      const match = tx.description.match(/(.+) from (.+)/);
      if (!match) throw new Error('Cannot parse transaction description');
      const [, drugName, pharmacyName] = match;
      result = await executeMedicationPayment(
        tx.recipient,
        pharmacyName,
        drugName,
        tx.amount,
      );
    } else if (tx.category === TRANSACTION_CATEGORY.BILLS) {
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

  if (tx.category === TRANSACTION_CATEGORY.MEDICATIONS) {
    spendingTracker.medications += tx.amount;
    agentSpendingUsd.set(
      { category: TRANSACTION_CATEGORY.MEDICATIONS },
      spendingTracker.medications,
    );
  } else if (tx.category === TRANSACTION_CATEGORY.BILLS) {
    spendingTracker.bills += tx.amount;
    agentSpendingUsd.set({ category: TRANSACTION_CATEGORY.BILLS }, spendingTracker.bills);
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
  if (amount > getPlatformTxCap()) {
    return {
      success: false,
      error: `BLOCKED BY PLATFORM CAP: $${amount.toFixed(2)} exceeds MAX_SINGLE_TX_USDC ($${getPlatformTxCap().toFixed(2)})`,
    };
  }
  // Atomically check policy and reserve the budget before the async payment
  // check when only one slot remains in the budget.
  const release = await getBudgetMutex(currentRecipientId).acquire();
  let policyCheck: ReturnType<typeof checkSpendingPolicy>;
  try {
    policyCheck = checkSpendingPolicy(
      amount,
      TRANSACTION_CATEGORY.MEDICATIONS,
    );
    if (!policyCheck.allowed) {
      const reason = policyCheck.reason!.includes('daily')
        ? 'daily_limit'
        : policyCheck.reason!.includes('overall monthly limit')
          ? 'monthly_limit'
          : 'budget';
      policyBlocksTotal.inc({ reason });
      paymentRejectedTotal.inc({ reason });

      const tx = {
        id: `tx-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'medication' as const,
        description: `${drugName} from ${pharmacyName}`,
        amount,
        recipient: pharmacyId,
        status: 'blocked' as const,
        category: TRANSACTION_CATEGORY.MEDICATIONS,
      };
      spendingTracker.transactions.push(tx);
      appendTransaction(tx as any);

      // Surface the full budget context so the LLM can decide whether to ask
      // the caregiver for an override or pick a cheaper option (Issue #160).
      const dailyRemaining = policyCheck.dailyRemaining ?? 0;
      const monthlyRemaining = policyCheck.monthlyRemaining ?? 0;
      const budgetContext = {
        reason,
        attempted: amount,
        dailyRemaining,
        monthlyRemaining,
        suggestion:
          `Relay this to the caregiver: the $${amount.toFixed(2)} payment was blocked by the spending policy. ` +
          `Remaining budget is $${dailyRemaining.toFixed(2)} today and $${monthlyRemaining.toFixed(2)} this month for ${TRANSACTION_CATEGORY.MEDICATIONS}. ` +
          `Ask them to approve a one-time override, or choose a cheaper option that fits the remaining budget.`,
      };

      return {
        success: false,
        error: `BLOCKED BY SPENDING POLICY: ${policyCheck.reason}`,
        transaction: tx,
        budgetContext,
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
        type: 'medication' as const,
        description: `${drugName} from ${pharmacyName}`,
        amount,
        recipient: pharmacyId,
        status: 'pending' as const,
        category: TRANSACTION_CATEGORY.MEDICATIONS,
        pendingUntil,
        submittedAt,
      };
      spendingTracker.transactions.push(tx);
      agentTransactionsTotal.inc({ status: 'pending' });
      // Append only the new pending transaction — O(1) write (Issue #205)
      appendTransaction(tx);
      return {
        success: false,
        error: `REQUIRES CAREGIVER APPROVAL: ${amount.toFixed(2)} exceeds the ${currentPolicy.approvalThreshold} approval threshold.`,
        transaction: tx,
      };
    }
    // Reserve the budget before releasing the mutex so no other concurrent call
    // can observe the pre-payment balance and pass a check it should fail.
    spendingTracker.medications += amount;
  } finally {
    release();
  }

  // Execute real MPP charge payment to pharmacy (outside the mutex — can be slow)
  const paymentResult = await executeMedicationPayment(
    pharmacyId,
    pharmacyName,
    drugName,
    amount,
  );
  if (!paymentResult.success) {
    // Roll back the optimistic reservation on payment failure.
    spendingTracker.medications -= amount;
    return paymentResult;
  }

  const tx: Transaction = {
    id: `tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'medication' as const,
    description: `${drugName} from ${pharmacyName} [MPP Charge]`,
    amount,
    recipient: pharmacyId,
    stellarTxHash: paymentResult.stellarTxHash,
    mppOrderId: paymentResult.mppOrderId,
    status: 'completed' as const,
    category: TRANSACTION_CATEGORY.MEDICATIONS,
  };

  // medications was already incremented during the reservation step above.
  spendingTracker.transactions.push(tx);
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set(
    { category: TRANSACTION_CATEGORY.MEDICATIONS },
    spendingTracker.medications,
  );
  // Append only the new completed transaction — O(1) write (Issue #205)
  appendTransaction(tx);

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
  if (amount > getPlatformTxCap()) {
    return {
      success: false,
      error: `BLOCKED BY PLATFORM CAP: $${amount.toFixed(2)} exceeds MAX_SINGLE_TX_USDC ($${getPlatformTxCap().toFixed(2)})`,
    };
  }
  // Atomically check policy and reserve the budget before the async payment
  // (Issue #209).
  const releaseBill = await getBudgetMutex(currentRecipientId).acquire();
  let billPolicyCheck: ReturnType<typeof checkSpendingPolicy>;
  try {
    billPolicyCheck = checkSpendingPolicy(amount, TRANSACTION_CATEGORY.BILLS);
    if (!billPolicyCheck.allowed) {
      const reason = billPolicyCheck.reason!.includes('daily')
        ? 'daily_limit'
        : 'budget';
      policyBlocksTotal.inc({ reason });
      
      const tx = {
        id: `tx-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'bill' as const,
        description: `${description} — ${providerName}`,
        amount,
        recipient: providerId,
        status: 'blocked' as const,
        category: TRANSACTION_CATEGORY.BILLS,
      };
      spendingTracker.transactions.push(tx);
      appendTransaction(tx as any);

      return {
        success: false,
        error: `BLOCKED BY SPENDING POLICY: ${billPolicyCheck.reason}`,
        transaction: tx,
      };
    }
    if (billPolicyCheck.requiresApproval && !skipApproval) {
      policyBlocksTotal.inc({ reason: 'approval_required' });
      const holdSeconds = (currentPolicy as any)?.holdTimeSeconds ?? 0;
      const submittedAt = new Date().toISOString();
      const pendingUntil = new Date(
        Date.now() + holdSeconds * 1000,
      ).toISOString();
      const tx: Transaction & { pendingUntil?: string; submittedAt?: string } = {
        id: `tx-${Date.now()}`,
        timestamp: submittedAt,
        type: 'bill' as const,
        description: `${description} — ${providerName}`,
        amount,
        recipient: providerId,
        status: 'pending' as const,
        category: TRANSACTION_CATEGORY.BILLS,
        pendingUntil,
        submittedAt,
      };
      spendingTracker.transactions.push(tx);
      agentTransactionsTotal.inc({ status: 'pending' });
      // Append only the new pending transaction — O(1) write (Issue #205)
      appendTransaction(tx);
      return {
        success: false,
        error: `REQUIRES CAREGIVER APPROVAL: ${amount.toFixed(2)} exceeds the ${currentPolicy.approvalThreshold} approval threshold.`,
        transaction: tx,
      };
    }
    // Reserve the budget before releasing the mutex.
    spendingTracker.bills += amount;
  } finally {
    releaseBill();
  }

  // Execute real Stellar USDC transfer (outside the mutex — can be slow)
  const recipientKey = process.env.BILL_PROVIDER_PUBLIC_KEY;
  if (!recipientKey) {
    spendingTracker.bills -= amount; // roll back reservation
    return { success: false, error: 'BILL_PROVIDER_PUBLIC_KEY not configured' };
  }

  logger.info(
    { provider: providerName, amount },
    '[Stellar] transferring USDC',
  );

  let stellarTxHash: string | undefined;

  try {
    const buildStellarTx = async () => {
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
        .setTimeout(STELLAR_TIMEBOUNDS_SECONDS)
        .build();

      stellarTx.sign(agentKeypair);

      const sigHint = stellarTx.signatures[0]?.hint();
      if (!sigHint || !sigHint.equals(agentKeypair.signatureHint())) {
        throw new Error(
          `Signer mismatch: expected ${agentKeypair.publicKey()} — refusing to submit`
        );
      }
      return stellarTx;
    };

    let stellarTx = await buildStellarTx();
    console.log(`  [Stellar] Signer verified: ${agentKeypair.publicKey().slice(0, 8)}...`);

    const result = await submitTransactionWithRetry(horizonServer, stellarTx, 2, 35000, buildStellarTx);

    stellarTxHash = result.hash;
    logger.info({ txHash: stellarTxHash, fee: result.fee }, '[Stellar] TX confirmed');
  } catch (err: any) {
    stellarTxSubmittedTotal.inc({ result: 'error' });
    const errorDetail =
      err?.response?.data?.extras?.result_codes || err.message;
    spendingTracker.bills -= amount; // roll back reservation on Stellar failure
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
    type: 'bill' as const,
    description: `${description} — ${providerName} [Stellar USDC]`,
    amount,
    recipient: providerId,
    stellarTxHash,
    status: 'completed' as const,
    category: TRANSACTION_CATEGORY.BILLS,
  };

  // bills was already incremented during the reservation step above.
  spendingTracker.transactions.push(tx);
  agentTransactionsTotal.inc({ status: 'completed' });
  agentSpendingUsd.set({ category: TRANSACTION_CATEGORY.BILLS }, spendingTracker.bills);
  // Append only the new completed transaction — O(1) write (Issue #205)
  appendTransaction(tx);

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
  const policy = loadPolicy();
  const total =
    spendingTracker.medications +
    spendingTracker.bills +
    spendingTracker.serviceFees;
  return {
    policy,
    spending: {
      medications: +spendingTracker.medications.toFixed(2),
      bills: +spendingTracker.bills.toFixed(2),
      serviceFees: +spendingTracker.serviceFees.toFixed(4),
      total: +total.toFixed(2),
    },
    budgetRemaining: {
      medications: +(
        policy.medicationMonthlyBudget - spendingTracker.medications
      ).toFixed(2),
      bills: +(policy.billMonthlyBudget - spendingTracker.bills).toFixed(2),
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
  writeAtomically(getOrdersFile(recipientId), JSON.stringify(orders, null, 2));
}

// --- Tool: Schedule an adherence reminder after pharmacy order (Issue #264) ---
const ADHERENCE_FILE = `${getDataDir()}/adherence.jsonl`;
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
    dosage: z.string().min(1),
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
  fetch_tool_result: z.object({
    result_id: z.string().min(1),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
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
      'Compare medication prices across multiple pharmacies. Pays $0.002 USDC per query via x402 on Stellar. Pass the medication dosage exactly as known; the returned dosage field is reliable and echoed from the request for safety. Returns prices sorted cheapest to most expensive, with potential savings. Each pharmacy has an inStock field: "unknown" means real-time inventory is unavailable (proceed with caution), true means in stock. Never assume a medication is in stock if inStock is "unknown" — confirm with the pharmacy before ordering.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        drug_name: { type: 'string', description: 'Name of the medication (e.g., Lisinopril, Metformin)' },
        dosage: { type: 'string', description: 'Medication dosage exactly as prescribed or provided (e.g., 10mg)' },
        zip_code: { type: 'string', description: 'ZIP code for pharmacy location (default: 90210)' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['drug_name', 'dosage'],
    }),
  },
  {
    name: 'audit_medical_bill',
    description:
      'Audit a medical bill for errors (duplicates, upcoding, overcharges). 80% of medical bills contain errors. Pays $0.01 USDC per audit via x402 on Stellar. Pass line_items_json as a JSON string array of line items. Each line item must include description, cptCode, quantity, and chargedAmount. cptCode must match /^(?:\\d{5}|J\\d{4})$/, quantity must be > 0, and chargedAmount must be > 0.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        line_items_json: {
          type: 'string',
          description: 'JSON string of line items array. Each item must include description, cptCode, quantity, and chargedAmount. Example: [{"description":"Office visit","cptCode":"99213","quantity":1,"chargedAmount":130}]',
        },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['line_items_json'],
    }),
  },
  {
    name: 'check_drug_interactions',
    description:
      'Check for drug-drug interactions. Pays $0.001 USDC per check via x402 on Stellar. Requires at least 2 medications; if fewer are supplied, the tool returns NEED_AT_LEAST_TWO_MEDS instead of claiming there are no interactions. Returns severity levels and clinical recommendations.',
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
    name: 'fetch_tool_result',
    description:
      'Fetch the remainder of a previously truncated tool result by result_id. Use this when a tool response includes resultId, summary, or hasMore=true and you need the full data before concluding.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        result_id: { type: 'string', description: 'Identifier returned in the truncated tool response' },
        offset: { type: 'number', description: 'Zero-based offset into the stored result (default: 0)' },
        limit: { type: 'number', description: 'Maximum number of items to fetch (default: 10)' },
      },
      required: ['result_id'],
    }),
  },
  {
    name: 'pay_for_medication',
    description:
      'Pay a pharmacy for a medication order via MPP Charge on Stellar (real USDC payment). Subject to spending policy limits. Amount must be between $0.01 and $10,000. If the payment is blocked by spending policy, the result includes a budgetContext object { reason, attempted, dailyRemaining, monthlyRemaining, suggestion }: relay it to the caregiver so they can either approve a one-time override or pick a cheaper option within the remaining budget.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        pharmacy_id: { type: 'string' },
        pharmacy_name: { type: 'string' },
        drug_name: { type: 'string' },
        amount: { type: 'number', description: 'Payment amount in USD (min: 0.01, max: 10000)' },
        days_supply: { type: 'number', description: 'Days supply for adherence tracking (default: 30)' },
        recipient_id: { type: 'string', description: 'Care recipient ID (default: rosa)' },
      },
      required: ['pharmacy_id', 'pharmacy_name', 'drug_name', 'amount'],
    }),
  },
  {
    name: 'pay_bill',
    description:
      'Pay a medical bill via direct Stellar USDC transfer. Subject to spending policy limits. If the bill has been audited and errors found, pay only the corrected amount. Amount must be between $0.01 and $10,000.',
    input_schema: strictInputSchema({
      type: 'object' as const,
      properties: {
        provider_id: { type: 'string' },
        provider_name: { type: 'string' },
        description: { type: 'string' },
        amount: { type: 'number', description: 'Payment amount in USD (min: 0.01, max: 10000)' },
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
const pendingTransactionScanner = setInterval(() => {
  processPendingTransactions().catch((err) => {
    logger.error(
      { err: err?.message || err },
      '[PendingScanner] error scanning pending transactions',
    );
  });
}, 5000);
pendingTransactionScanner.unref?.();

const spendingCacheRefreshTimer = setInterval(() => {
  for (const recipientId of spendingCache.keys()) {
    try {
      spendingCache.set(recipientId, {
        data: readSpendingFromDisk(recipientId),
        loadedAt: Date.now(),
      });
    } catch (err: any) {
      logger.warn(
        { recipientId, err: err?.message || err },
        '[SpendingCache] refresh failed',
      );
    }
  }
}, SPENDING_CACHE_TTL_MS);
spendingCacheRefreshTimer.unref?.();
