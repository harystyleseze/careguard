import { z } from "zod";

/**
 * Strict zod validators for LLM-supplied tool arguments, applied by
 * `executeTool` (agent/runner.ts) before every tool call.
 *
 * The schemas are built once at module load and reused for every call — they
 * are never recompiled per invocation. See
 * docs/performance/task-validation-1312.md for the measured overhead.
 */

const recipientIdSchema = z.string().min(1).optional();
const amountSchema = z.union([z.number(), z.string()]);

/** get_handoff_notes page size (#1180). */
export const HANDOFF_NOTES_TOOL_DEFAULT = 3;
export const HANDOFF_NOTES_TOOL_MAX = 10;

export const TOOL_INPUT_SCHEMAS = {
  compare_pharmacy_prices: z
    .object({
      drug_name: z.string().min(1),
      dosage: z.string().min(1),
      zip_code: z.string().optional(),
      recipient_id: recipientIdSchema,
    })
    .strict(),
  audit_medical_bill: z
    .object({
      line_items_json: z.string().min(1).optional(),
      line_items: z.any().optional(),
      provider_id: z.string().optional(),
      provider_name: z.string().optional(),
      recipient_id: recipientIdSchema,
    })
    .strict(),
  check_drug_interactions: z
    .object({
      medications: z.array(z.string().min(1)),
      recipient_id: recipientIdSchema,
    })
    .strict(),
  fetch_tool_result: z
    .object({
      result_id: z.string().min(1),
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict(),
  pay_for_medication: z
    .object({
      pharmacy_id: z.string().min(1),
      pharmacy_name: z.string().min(1),
      drug_name: z.string().min(1),
      amount: amountSchema,
      days_supply: amountSchema.optional(),
      recipient_id: recipientIdSchema,
      cost_split: z.any().optional(),
      skip_approval: z.boolean().optional(),
    })
    .strict(),
  pay_bill: z
    .object({
      provider_id: z.string().min(1),
      provider_name: z.string().min(1),
      description: z.string().min(1),
      amount: amountSchema,
      recipient_id: recipientIdSchema,
      cost_split: z.any().optional(),
      skip_approval: z.boolean().optional(),
    })
    .strict(),
  check_spending_policy: z
    .object({
      amount: amountSchema,
      category: z.enum(["medications", "bills"]),
      recipient_id: recipientIdSchema,
    })
    .strict(),
  fetch_rosa_bill: z.object({}).strict(),
  fetch_and_audit_bill: z
    .object({
      recipient_id: recipientIdSchema,
    })
    .strict(),
  get_spending_summary: z
    .object({
      recipient_id: recipientIdSchema,
    })
    .strict(),
  get_wallet_balance: z.object({}).strict(),
  generate_dispute_letter: z
    .object({
      bill_id: z.string().min(1),
      audit_result_json: z.string().min(1),
      error_descriptions: z.array(z.string()).optional(),
      recipient_name: z.string().optional(),
      facility: z.string().optional(),
      caregiver_name: z.string().optional(),
      caregiver_email: z.string().optional(),
      reason: z
        .enum([
          "duplicate_charge",
          "coding_error",
          "balance_billing",
          "unbundling",
          "general_dispute",
        ])
        .optional(),
      recipient_id: recipientIdSchema,
    })
    .strict(),
  get_adherence_status: z
    .object({
      recipient_id: recipientIdSchema,
    })
    .strict(),
  confirm_adherence: z
    .object({
      record_id: z.string().min(1),
    })
    .strict(),
  get_handoff_notes: z
    .object({
      recipient_id: recipientIdSchema,
      limit: z.number().int().min(1).max(HANDOFF_NOTES_TOOL_MAX).optional(),
    })
    .strict(),
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
    .filter((issue) => issue.code === "unrecognized_keys")
    .flatMap((issue) => (issue as { keys?: string[] }).keys ?? []);
  if (unknownKeys.length > 0) {
    throw new Error(
      `Invalid tool input for ${name}: unknown field(s) not allowed: ${unknownKeys.join(", ")}`,
    );
  }

  const details = result.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid tool input for ${name}: ${details}`);
}
