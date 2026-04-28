import { z } from "zod";

export const SpendingPolicyInput = z.object({
  dailyLimit: z.number(),
  monthlyLimit: z.number(),
  medicationMonthlyBudget: z.number(),
  billMonthlyBudget: z.number(),
  approvalThreshold: z.number(),
});

export type SpendingPolicyInput = z.infer<typeof SpendingPolicyInput>;

export type PolicyFieldError = {
  field: keyof SpendingPolicyInput;
  message: string;
};

export type PolicyValidation = {
  errors: PolicyFieldError[];
  warnings: PolicyFieldError[];
  isValid: boolean;
};

const FIELD_LABEL: Record<keyof SpendingPolicyInput, string> = {
  dailyLimit: "Daily limit",
  monthlyLimit: "Monthly limit",
  medicationMonthlyBudget: "Medication budget",
  billMonthlyBudget: "Bill budget",
  approvalThreshold: "Approval threshold",
};

export function validatePolicy(input: unknown): PolicyValidation {
  const errors: PolicyFieldError[] = [];
  const warnings: PolicyFieldError[] = [];

  const parsed = SpendingPolicyInput.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof SpendingPolicyInput | undefined;
      if (field && field in FIELD_LABEL) {
        errors.push({ field, message: `${FIELD_LABEL[field]} must be a number` });
      }
    }
    return { errors, warnings, isValid: false };
  }

  const v = parsed.data;
  const fields: (keyof SpendingPolicyInput)[] = [
    "dailyLimit",
    "monthlyLimit",
    "medicationMonthlyBudget",
    "billMonthlyBudget",
    "approvalThreshold",
  ];
  for (const f of fields) {
    if (!Number.isFinite(v[f])) {
      errors.push({ field: f, message: `${FIELD_LABEL[f]} must be a finite number` });
    } else if (v[f] <= 0) {
      errors.push({ field: f, message: `${FIELD_LABEL[f]} must be greater than 0` });
    }
  }

  if (Number.isFinite(v.dailyLimit) && Number.isFinite(v.monthlyLimit) && v.dailyLimit > v.monthlyLimit) {
    errors.push({
      field: "dailyLimit",
      message: "Daily limit cannot exceed monthly limit",
    });
  }

  if (
    Number.isFinite(v.approvalThreshold) &&
    Number.isFinite(v.dailyLimit) &&
    v.approvalThreshold > v.dailyLimit
  ) {
    errors.push({
      field: "approvalThreshold",
      message: "Approval threshold cannot exceed daily limit",
    });
  }

  if (
    Number.isFinite(v.medicationMonthlyBudget) &&
    Number.isFinite(v.billMonthlyBudget) &&
    Number.isFinite(v.monthlyLimit) &&
    v.medicationMonthlyBudget + v.billMonthlyBudget > v.monthlyLimit * 1.2
  ) {
    warnings.push({
      field: "medicationMonthlyBudget",
      message: "Combined category budgets exceed 120% of monthly limit",
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
