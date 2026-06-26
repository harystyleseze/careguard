type ToolLogAllowlist = Record<string, readonly string[]>;

export const SAFE_TOOL_LOG_FIELDS = {
  compare_pharmacy_prices: ["drug_name", "dosage"],
  audit_medical_bill: [],
  check_drug_interactions: [],
  fetch_tool_result: ["result_id", "offset", "limit"],
  pay_for_medication: ["pharmacy_id", "pharmacy_name", "drug_name", "days_supply"],
  pay_bill: ["provider_id", "provider_name"],
  check_spending_policy: ["category"],
  fetch_rosa_bill: [],
  fetch_and_audit_bill: [],
  get_spending_summary: [],
  get_wallet_balance: [],
  generate_dispute_letter: ["bill_id", "facility"],
  get_adherence_status: [],
  confirm_adherence: ["record_id"],
} as const satisfies ToolLogAllowlist;

function summarizeAllowedValue(value: unknown): unknown {
  if (Array.isArray(value)) return `<array: ${value.length} items>`;
  if (value && typeof value === "object") return "<object>";
  return value;
}

export function redactToolCallInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const allowedFields: ReadonlySet<string> = new Set(
    SAFE_TOOL_LOG_FIELDS[toolName as keyof typeof SAFE_TOOL_LOG_FIELDS] ?? [],
  );

  return Object.fromEntries(
    Object.entries(input).map(([field, value]) => [
      field,
      allowedFields.has(field)
        ? summarizeAllowedValue(value)
        : `<redacted: ${field}>`,
    ]),
  );
}

export function buildToolCallLogFields(
  toolName: string,
  input: Record<string, unknown>,
): { tool: string; args: Record<string, unknown> } {
  return {
    tool: toolName,
    args: redactToolCallInput(toolName, input),
  };
}
