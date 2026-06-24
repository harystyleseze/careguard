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
