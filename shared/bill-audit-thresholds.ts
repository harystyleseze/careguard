export interface BillAuditThresholds {
  overchargeMultiplier: number;
  suggestedMultiplier: number;
  upcodedMultiplier: number;
}

export type BillAuditChargeStatus = "valid" | "overcharged" | "upcoded";

export const DEFAULT_BILL_AUDIT_THRESHOLDS: BillAuditThresholds = {
  overchargeMultiplier: 1.5,
  suggestedMultiplier: 1.2,
  upcodedMultiplier: 3.0,
};

const ENV_KEYS = {
  overchargeMultiplier: "BILL_AUDIT_OVERCHARGE_MULTIPLIER",
  suggestedMultiplier: "BILL_AUDIT_SUGGESTED_MULTIPLIER",
  upcodedMultiplier: "BILL_AUDIT_UPCODED_MULTIPLIER",
} as const;

type ThresholdEnv = Record<string, string | undefined>;

function parseMultiplier(env: ThresholdEnv, key: string, defaultValue: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }

  return value;
}

export function validateBillAuditThresholds(thresholds: BillAuditThresholds): BillAuditThresholds {
  const { overchargeMultiplier, suggestedMultiplier, upcodedMultiplier } = thresholds;

  if (
    !Number.isFinite(overchargeMultiplier) ||
    !Number.isFinite(suggestedMultiplier) ||
    !Number.isFinite(upcodedMultiplier)
  ) {
    throw new Error("Bill audit threshold multipliers must be finite numbers");
  }

  if (!(upcodedMultiplier > overchargeMultiplier && overchargeMultiplier > suggestedMultiplier && suggestedMultiplier > 1.0)) {
    throw new Error(
      "Bill audit threshold multipliers must satisfy BILL_AUDIT_UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0",
    );
  }

  return thresholds;
}

export function readBillAuditThresholds(env: ThresholdEnv = process.env): BillAuditThresholds {
  return validateBillAuditThresholds({
    overchargeMultiplier: parseMultiplier(
      env,
      ENV_KEYS.overchargeMultiplier,
      DEFAULT_BILL_AUDIT_THRESHOLDS.overchargeMultiplier,
    ),
    suggestedMultiplier: parseMultiplier(
      env,
      ENV_KEYS.suggestedMultiplier,
      DEFAULT_BILL_AUDIT_THRESHOLDS.suggestedMultiplier,
    ),
    upcodedMultiplier: parseMultiplier(env, ENV_KEYS.upcodedMultiplier, DEFAULT_BILL_AUDIT_THRESHOLDS.upcodedMultiplier),
  });
}

export function getOverchargeMultiplier(
  cptCode: string,
  thresholds: BillAuditThresholds,
  overchargeMultiplierByCpt: Record<string, number> = {},
): number {
  return overchargeMultiplierByCpt[cptCode] ?? thresholds.overchargeMultiplier;
}

export function getBillAuditChargeStatus({
  cptCode,
  chargedAmount,
  fairAmount,
  thresholds,
  overchargeMultiplierByCpt = {},
}: {
  cptCode: string;
  chargedAmount: number;
  fairAmount: number | null;
  thresholds: BillAuditThresholds;
  overchargeMultiplierByCpt?: Record<string, number>;
}): BillAuditChargeStatus {
  if (fairAmount === null) {
    return "valid";
  }

  const overchargeMultiplier = getOverchargeMultiplier(cptCode, thresholds, overchargeMultiplierByCpt);
  if (chargedAmount <= fairAmount * overchargeMultiplier) {
    return "valid";
  }

  return chargedAmount > fairAmount * thresholds.upcodedMultiplier ? "upcoded" : "overcharged";
}

export function getBillAuditSuggestedAmount({
  fairAmount,
  chargedAmount,
  thresholds,
  capAtCharged = true,
}: {
  fairAmount: number | null;
  chargedAmount: number;
  thresholds: BillAuditThresholds;
  capAtCharged?: boolean;
}): number {
  if (fairAmount === null) {
    return chargedAmount;
  }

  const suggested = +(fairAmount * thresholds.suggestedMultiplier).toFixed(2);
  return capAtCharged ? Math.min(chargedAmount, suggested) : suggested;
}
