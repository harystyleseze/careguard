import { z } from 'zod';

export const SpendingPolicyInput = z.object({
  dailyLimit: z.number(),
  monthlyLimit: z.number(),
  medicationMonthlyBudget: z.number(),
  billMonthlyBudget: z.number(),
  approvalThreshold: z.number(),
  holdTimeSeconds: z.number(),
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
  dailyLimit: 'Daily limit',
  monthlyLimit: 'Monthly limit',
  medicationMonthlyBudget: 'Medication budget',
  billMonthlyBudget: 'Bill budget',
  approvalThreshold: 'Approval threshold',
  holdTimeSeconds: 'Hold time before auto-approval (seconds)',
};

export function validatePolicy(input: unknown): PolicyValidation {
  const errors: PolicyFieldError[] = [];
  const warnings: PolicyFieldError[] = [];

  const parsed = SpendingPolicyInput.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof SpendingPolicyInput | undefined;
      if (field && field in FIELD_LABEL) {
        errors.push({
          field,
          message: `${FIELD_LABEL[field]} must be a number`,
        });
      }
    }
    return { errors, warnings, isValid: false };
  }

  const v = parsed.data;
  const moneyFields: (keyof SpendingPolicyInput)[] = [
    'dailyLimit',
    'monthlyLimit',
    'medicationMonthlyBudget',
    'billMonthlyBudget',
    'approvalThreshold',
  ];
  // holdTimeSeconds may be 0 (no hold), money fields must be ≥ 1 (#211)
  const allFields: (keyof SpendingPolicyInput)[] = [...moneyFields, 'holdTimeSeconds'];

  for (const f of allFields) {
    if (!Number.isFinite(v[f])) {
      errors.push({
        field: f,
        message: `${FIELD_LABEL[f]} must be a finite number`,
      });
    } else if (moneyFields.includes(f as any) && v[f] < 1) {
      errors.push({
        field: f,
        message: `${FIELD_LABEL[f]} must be at least 1`,
      });
    } else if (f === 'holdTimeSeconds' && v[f] < 0) {
      errors.push({
        field: f,
        message: `${FIELD_LABEL[f]} cannot be negative`,
      });
    } else if (v[f] > 50000) {
      errors.push({
        field: f,
        message: `${FIELD_LABEL[f]} cannot exceed 50,000`,
      });
    }
  }

  if (
    Number.isFinite(v.dailyLimit) &&
    Number.isFinite(v.monthlyLimit) &&
    v.dailyLimit > v.monthlyLimit
  ) {
    errors.push({
      field: 'dailyLimit',
      message: 'Daily limit cannot exceed monthly limit',
    });
  }

  const approvalCap = Math.min(
    v.dailyLimit,
    v.medicationMonthlyBudget,
    v.billMonthlyBudget,
  );
  if (
    Number.isFinite(v.approvalThreshold) &&
    Number.isFinite(approvalCap) &&
    v.approvalThreshold > approvalCap
  ) {
    errors.push({
      field: 'approvalThreshold',
      message:
        'Approval threshold cannot exceed the smallest budget cap (daily, medication, bill)',
    });
  }

  if (
    Number.isFinite(v.medicationMonthlyBudget) &&
    Number.isFinite(v.billMonthlyBudget) &&
    Number.isFinite(v.monthlyLimit) &&
    v.medicationMonthlyBudget + v.billMonthlyBudget > v.monthlyLimit
  ) {
    errors.push({
      field: 'medicationMonthlyBudget',
      message:
        'Medication and bill budgets together cannot exceed monthly limit',
    });
  }

  return { errors, warnings, isValid: errors.length === 0 };
}
