import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.MOCK_NETWORK = "1";
  process.env.AGENT_SECRET_KEY = "test-agent-secret";
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

const { TOOL_DEFINITIONS, validateToolInput } = await import("../tools.ts");

describe("tool schema strictness", () => {
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
    expect(() =>
      validateToolInput("get_spending_summary", {
        recipient_id: "rosa",
        unexpected: "ignored-before",
      }),
    ).toThrow(/unknown field\(s\) not allowed: unexpected/);
  });
});

describe("per-tool input validation — missing fields (#277)", () => {
  it("compare_pharmacy_prices: rejects missing drug_name", () => {
    expect(() => validateToolInput("compare_pharmacy_prices", {}))
      .toThrow(/drug_name/);
  });

  it("check_drug_interactions: rejects missing medications", () => {
    expect(() => validateToolInput("check_drug_interactions", {}))
      .toThrow(/medications/);
  });

  it("pay_for_medication: rejects missing required fields", () => {
    expect(() => validateToolInput("pay_for_medication", { drug_name: "Lisinopril" }))
      .toThrow(/pharmacy_id|pharmacy_name|amount/);
  });

  it("pay_bill: rejects missing required fields", () => {
    expect(() => validateToolInput("pay_bill", { description: "ER visit" }))
      .toThrow(/provider_id|provider_name|amount/);
  });

  it("check_spending_policy: rejects missing amount and category", () => {
    expect(() => validateToolInput("check_spending_policy", {}))
      .toThrow(/amount|category/);
  });

  it("audit_medical_bill: rejects missing line_items_json", () => {
    expect(() => validateToolInput("audit_medical_bill", {}))
      .toThrow(/line_items_json/);
  });
});

describe("per-tool input validation — wrong types (#277)", () => {
  it("compare_pharmacy_prices: rejects numeric drug_name", () => {
    expect(() => validateToolInput("compare_pharmacy_prices", { drug_name: 123 }))
      .toThrow();
  });

  it("check_drug_interactions: rejects string instead of array", () => {
    expect(() => validateToolInput("check_drug_interactions", { medications: "Aspirin" }))
      .toThrow();
  });

  it("pay_for_medication: rejects string amount", () => {
    expect(() =>
      validateToolInput("pay_for_medication", {
        pharmacy_id: "p1",
        pharmacy_name: "CVS",
        drug_name: "Lisinopril",
        amount: "fifty",
      }),
    ).toThrow();
  });

  it("pay_bill: rejects boolean amount", () => {
    expect(() =>
      validateToolInput("pay_bill", {
        provider_id: "h1",
        provider_name: "Hospital",
        description: "ER visit",
        amount: true,
      }),
    ).toThrow();
  });

  it("check_spending_policy: rejects invalid category enum", () => {
    expect(() =>
      validateToolInput("check_spending_policy", { amount: 50, category: "transport" }),
    ).toThrow();
  });
});

describe("per-tool input validation — extra fields rejected (#277)", () => {
  it("compare_pharmacy_prices: rejects extra field", () => {
    expect(() =>
      validateToolInput("compare_pharmacy_prices", {
        drug_name: "Lisinopril",
        surprise: "extra",
      }),
    ).toThrow(/unknown field/);
  });

  it("get_spending_summary: rejects any extra field", () => {
    expect(() =>
      validateToolInput("get_spending_summary", { recipient_id: "rosa" }),
    ).toThrow(/unknown field/);
  });

  it("fetch_rosa_bill: rejects any extra field", () => {
    expect(() =>
      validateToolInput("fetch_rosa_bill", { extra: "value" }),
    ).toThrow(/unknown field/);
  });
});
