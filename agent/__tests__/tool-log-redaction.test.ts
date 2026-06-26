import { describe, expect, it } from "vitest";
import {
  SAFE_TOOL_LOG_FIELDS,
  buildToolCallLogFields,
  redactToolCallInput,
} from "../tool-log-redaction.ts";

const TOOL_INPUTS: Record<keyof typeof SAFE_TOOL_LOG_FIELDS, Record<string, unknown>> = {
  compare_pharmacy_prices: {
    drug_name: "Lisinopril",
    dosage: "10mg",
    zip_code: "90210",
    recipient_id: "rosa",
  },
  audit_medical_bill: {
    line_items_json: '[{"chargedAmount":999}]',
    recipient_id: "rosa",
  },
  check_drug_interactions: {
    medications: ["Lisinopril", "Metformin"],
    recipient_id: "rosa",
  },
  fetch_tool_result: {
    result_id: "result-123",
    offset: 0,
    limit: 10,
  },
  pay_for_medication: {
    pharmacy_id: "pharm-1",
    pharmacy_name: "Downtown Pharmacy",
    drug_name: "Lisinopril",
    amount: 42.5,
    days_supply: 30,
    recipient_id: "rosa",
  },
  pay_bill: {
    provider_id: "provider-1",
    provider_name: "General Hospital",
    description: "Surgery follow-up",
    amount: 600,
    recipient_id: "rosa",
  },
  check_spending_policy: {
    amount: 600,
    category: "bills",
    recipient_id: "rosa",
  },
  fetch_rosa_bill: {
    recipient_id: "rosa",
  },
  fetch_and_audit_bill: {
    recipient_id: "rosa",
  },
  get_spending_summary: {
    recipient_id: "rosa",
  },
  get_wallet_balance: {
    address: "GSECRET",
  },
  generate_dispute_letter: {
    bill_id: "bill-1",
    audit_result_json: '{"totalOvercharge":500}',
    error_descriptions: ["Duplicate charge"],
    recipient_name: "Rosa Garcia",
    facility: "General Hospital",
    caregiver_name: "Maria Garcia",
    caregiver_email: "maria@example.com",
    recipient_id: "rosa",
  },
  get_adherence_status: {
    recipient_id: "rosa",
  },
  confirm_adherence: {
    record_id: "adh-1",
    recipient_id: "rosa",
  },
};

describe("tool call log redaction", () => {
  it("has a test input for every allowlisted tool", () => {
    expect(Object.keys(TOOL_INPUTS).sort()).toEqual(
      Object.keys(SAFE_TOOL_LOG_FIELDS).sort(),
    );
  });

  for (const [tool, input] of Object.entries(TOOL_INPUTS)) {
    it(`redacts non-allowlisted ${tool} fields`, () => {
      const redacted = redactToolCallInput(tool, input);
      const safeFields: ReadonlySet<string> = new Set(
        SAFE_TOOL_LOG_FIELDS[tool as keyof typeof SAFE_TOOL_LOG_FIELDS],
      );

      for (const [field, value] of Object.entries(input)) {
        if (safeFields.has(field)) {
          expect(redacted[field]).toEqual(value);
        } else {
          expect(redacted[field]).toBe(`<redacted: ${field}>`);
        }
      }
    });
  }

  it("logs tool calls as structured args instead of a truncated string", () => {
    const fields = buildToolCallLogFields("pay_bill", TOOL_INPUTS.pay_bill);

    expect(fields.tool).toBe("pay_bill");
    expect(typeof fields.args).toBe("object");
    expect(fields.args.provider_name).toBe("General Hospital");
    expect(fields.args.amount).toBe("<redacted: amount>");
    expect(fields.args.recipient_id).toBe("<redacted: recipient_id>");
  });

  it("redacts every field for unknown tools", () => {
    expect(redactToolCallInput("unknown_tool", { amount: 10, foo: "bar" })).toEqual({
      amount: "<redacted: amount>",
      foo: "<redacted: foo>",
    });
  });
});
