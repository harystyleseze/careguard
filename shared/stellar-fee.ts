import {
  FeeBumpTransaction,
  Keypair,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { logger as defaultLogger } from "./logger.ts";
import { stellarFeeBumpsTotal } from "./metrics.ts";

export const MIN_STELLAR_FEE_STROOPS = 100;
export const DEFAULT_MAX_STELLAR_FEE_STROOPS = 100000;
export const DEFAULT_FEE_BUMP_ATTEMPTS = 3;

export interface HorizonFeeServer {
  feeStats(): Promise<{
    fee_charged?: {
      p90?: unknown;
      mode?: unknown;
    };
    last_ledger_base_fee?: unknown;
  }>;
}

export interface HorizonSubmitServer {
  submitTransaction(
    transaction: Transaction | FeeBumpTransaction,
    opts?: unknown,
  ): Promise<{ hash: string; fee_charged?: string }>;
}

interface StellarFeeLogger {
  warn: (...args: unknown[]) => void;
}

interface FeeOptions {
  minFee?: number;
  maxFee?: number;
  logger?: StellarFeeLogger;
}

export interface FeeBumpEvent {
  attempt: number;
  oldFee: string;
  newFee: string;
}

export interface SubmitWithFeeBumpOptions {
  maxFeeBumps?: number;
  maxFee?: number;
  timeoutMs?: number;
  logger?: StellarFeeLogger;
  onFeeBump?: (event: FeeBumpEvent) => void;
}

export interface SubmitWithFeeBumpResult {
  hash: string;
  fee: string;
  feeBumps: number;
}

function configuredMaxFee() {
  return parseFeeStroops(process.env.MAX_FEE_STROOPS) ?? DEFAULT_MAX_STELLAR_FEE_STROOPS;
}

export function parseFeeStroops(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function clampFee(fee: number, minFee: number, maxFee: number) {
  return Math.min(Math.max(fee, minFee), maxFee);
}

export async function getTargetFee(
  horizon: HorizonFeeServer,
  options: FeeOptions = {},
): Promise<string> {
  const minFee = options.minFee ?? MIN_STELLAR_FEE_STROOPS;
  const maxFee = options.maxFee ?? configuredMaxFee();
  const log = options.logger ?? defaultLogger;

  try {
    const stats = await horizon.feeStats();
    const fee =
      parseFeeStroops(stats.fee_charged?.p90) ??
      parseFeeStroops(stats.fee_charged?.mode) ??
      parseFeeStroops(stats.last_ledger_base_fee) ??
      minFee;

    return String(clampFee(fee, minFee, maxFee));
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[Stellar] Failed to fetch fee stats, using minimum fee",
    );
    return String(minFee);
  }
}

export function extractTransactionResultCode(error: unknown): string | undefined {
  const resultCode = (error as {
    response?: {
      data?: {
        extras?: {
          result_codes?: {
            transaction?: unknown;
          };
        };
      };
    };
  })?.response?.data?.extras?.result_codes?.transaction;

  return typeof resultCode === "string" ? resultCode : undefined;
}

export function isInsufficientFeeError(error: unknown): boolean {
  return extractTransactionResultCode(error) === "tx_insufficient_fee";
}

export function nextFeeBumpBaseFee(
  currentFee: string,
  options: { maxFee?: number } = {},
): string {
  const maxFee = options.maxFee ?? configuredMaxFee();
  const parsedFee = parseFeeStroops(currentFee) ?? MIN_STELLAR_FEE_STROOPS;
  return String(clampFee(parsedFee * 2, MIN_STELLAR_FEE_STROOPS, maxFee));
}

export function buildFeeBumpEnvelope(
  innerTx: Transaction,
  feeSource: Keypair | string,
  baseFee: string,
  networkPassphrase: string,
): FeeBumpTransaction {
  return TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    baseFee,
    innerTx,
    networkPassphrase,
  );
}

export async function submitWithFeeBump(
  server: HorizonSubmitServer,
  innerTx: Transaction,
  feeSource: Keypair,
  networkPassphrase: string,
  options: SubmitWithFeeBumpOptions = {},
): Promise<SubmitWithFeeBumpResult> {
  const maxFeeBumps = options.maxFeeBumps ?? DEFAULT_FEE_BUMP_ATTEMPTS;
  const log = options.logger ?? defaultLogger;
  const submitOptions = options.timeoutMs === undefined
    ? undefined
    : { timeout: options.timeoutMs };
  let currentFee = innerTx.fee || String(MIN_STELLAR_FEE_STROOPS);

  try {
    const result = await server.submitTransaction(innerTx, submitOptions);
    return { hash: result.hash, fee: currentFee, feeBumps: 0 };
  } catch (err) {
    if (!isInsufficientFeeError(err)) {
      throw err;
    }
  }

  for (let attempt = 1; attempt <= maxFeeBumps; attempt++) {
    const oldFee = currentFee;
    currentFee = nextFeeBumpBaseFee(currentFee, { maxFee: options.maxFee });
    const feeBumpTx = buildFeeBumpEnvelope(
      innerTx,
      feeSource,
      currentFee,
      networkPassphrase,
    );
    feeBumpTx.sign(feeSource);

    const event = { attempt, oldFee, newFee: currentFee };
    options.onFeeBump?.(event);
    stellarFeeBumpsTotal.inc();
    log.warn(event, "[Stellar] tx_insufficient_fee, submitting fee-bump envelope");

    try {
      const result = await server.submitTransaction(feeBumpTx, submitOptions);
      return { hash: result.hash, fee: currentFee, feeBumps: attempt };
    } catch (err) {
      if (!isInsufficientFeeError(err) || attempt === maxFeeBumps) {
        throw err;
      }
    }
  }

  throw new Error("Failed to submit transaction after fee-bump retries");
}
