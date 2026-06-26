import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MOCK_NETWORK = "1";
  process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
});

vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn().mockReturnValue({
      publicKey: () => "GMOCKAGENT",
      sign: vi.fn(),
    }),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn() },
  Asset: vi.fn(),
  Horizon: {
    Server: vi.fn().mockReturnValue({
      feeStats: vi.fn(),
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
      transactions: vi.fn().mockReturnValue({
        transaction: vi.fn().mockReturnThis(),
        call: vi.fn(),
      }),
    }),
  },
}));

const { TOOL_DEFINITIONS, ToolInputValidationError, validateToolInput } = await import("../tools.ts");

const validToolInputs: Record<string, Record<string, unknown>> = {
  compare_pharmacy_prices: {
    drug_name: "Lisinopril",
    dosage: "10mg",
    zip_code: "90210",
    recipient_id: "rosa",
  },
  audit_medical_bill: {
    line_items_json: JSON.stringify([
      { description: "Office visit", cptCode: "99213", quantity: 1, chargedAmount: 130 },
    ]),
    recipient_id: "rosa",
  },
  check_drug_interactions: {
    medications: ["Lisinopril", "Ibuprofen"],
    recipient_id: "rosa",
  },
  fetch_tool_result: {
    result_id: "tool-result-123",
    offset: 0,
    limit: 10,
  },
  pay_for_medication: {
    pharmacy_id: "pharmacy-1",
    pharmacy_name: "Care Pharmacy",
    drug_name: "Metformin",
    amount: 12.5,
    days_supply: 30,
    recipient_id: "rosa",
  },
  pay_bill: {
    provider_id: "provider-1",
    provider_name: "Care Hospital",
    description: "Copay",
    amount: 25,
    recipient_id: "rosa",
  },
  check_spending_policy: {
    amount: 25,
    category: "bills",
    recipient_id: "rosa",
  },
  fetch_rosa_bill: {},
  fetch_and_audit_bill: {
    recipient_id: "rosa",
  },
  get_spending_summary: {
    recipient_id: "rosa",
  },
  get_wallet_balance: {},
  generate_dispute_letter: {
    bill_id: "bill-123",
    audit_result_json: JSON.stringify({ totalOvercharge: 25, errorCount: 1, lineItems: [] }),
    error_descriptions: ["Duplicate charge"],
    recipient_name: "Rosa Garcia",
    facility: "Care Hospital",
    caregiver_name: "Maria Garcia",
    caregiver_email: "maria@example.com",
    recipient_id: "rosa",
  },
  get_adherence_status: {
    recipient_id: "rosa",
  },
  confirm_adherence: {
    record_id: "record-123",
  },
};

const wrongTypeInputs: Record<string, unknown> = {
  compare_pharmacy_prices: { ...validToolInputs.compare_pharmacy_prices, drug_name: 123 },
  audit_medical_bill: { ...validToolInputs.audit_medical_bill, line_items_json: 42 },
  check_drug_interactions: { ...validToolInputs.check_drug_interactions, medications: "Lisinopril" },
  fetch_tool_result: { ...validToolInputs.fetch_tool_result, result_id: 123 },
  pay_for_medication: { ...validToolInputs.pay_for_medication, pharmacy_id: 123 },
  pay_bill: { ...validToolInputs.pay_bill, provider_id: 123 },
  check_spending_policy: { ...validToolInputs.check_spending_policy, category: "groceries" },
  fetch_rosa_bill: [],
  fetch_and_audit_bill: { recipient_id: 123 },
  get_spending_summary: { recipient_id: 123 },
  get_wallet_balance: [],
  generate_dispute_letter: { ...validToolInputs.generate_dispute_letter, audit_result_json: 42 },
  get_adherence_status: { recipient_id: 123 },
  confirm_adherence: { record_id: 123 },
};

describe("tool schema strictness", () => {
  it("has a validation fixture for every tool definition", () => {
    const toolNames = TOOL_DEFINITIONS.map((tool) => tool.name).sort();

    expect(Object.keys(validToolInputs).sort()).toEqual(toolNames);
    expect(Object.keys(wrongTypeInputs).sort()).toEqual(toolNames);
  });

  it("sets additionalProperties:false on every object tool schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.input_schema.type).toBe("object");
      expect(tool.input_schema.additionalProperties).toBe(false);
    }
  });

  it("declares no-arg tools with empty properties and no dummy parameters", () => {
    const noArgTools = ["fetch_rosa_bill", "get_wallet_balance"];

    for (const name of noArgTools) {
      const tool = TOOL_DEFINITIONS.find((t) => t.name === name);
      expect(tool?.input_schema.properties).toEqual({});
      expect(tool?.input_schema.required).toEqual([]);
    }
  });

  it("rejects unknown LLM tool fields with a clear message", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(() =>
        validateToolInput(tool.name, {
          ...validToolInputs[tool.name],
          unexpected: "ignored-before",
        }),
      ).toThrow(/unknown field\(s\) not allowed: unexpected/);
    }
  });

  it("rejects missing required fields for every tool that declares them", () => {
    for (const tool of TOOL_DEFINITIONS) {
      for (const requiredField of tool.input_schema.required) {
        const input = { ...validToolInputs[tool.name] };
        delete input[requiredField];

        expect(() => validateToolInput(tool.name, input)).toThrow(ToolInputValidationError);
      }
    }
  });

  it("rejects wrong-type arguments for every tool", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(() => validateToolInput(tool.name, wrongTypeInputs[tool.name])).toThrow(
        ToolInputValidationError,
      );
    }
  });

  it("returns typed validation errors for the agent loop", () => {
    try {
      validateToolInput("get_spending_summary", {
        recipient_id: 123,
      });
      throw new Error("Expected validateToolInput to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolInputValidationError);
      expect(err).toMatchObject({
        reason: "INVALID_TOOL_ARGUMENTS",
        issues: expect.arrayContaining([expect.stringContaining("recipient_id")]),
      });
    }
  });
});
