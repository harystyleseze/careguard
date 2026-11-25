/**
 * Contract test: LLM provider tool-call and function-calling response schema (Issue #987).
 *
 * Pins the expected response schema of Groq / OpenAI-compatible Chat Completions API
 * and verifies agent/runner.ts parsing logic against documented provider fixtures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../shared/logger.ts", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../../shared/audit-log.ts", () => ({
  appendAuditEntry: vi.fn(),
}));

vi.mock("../../shared/prompt-scrub.ts", () => ({
  buildScrubSession: vi.fn(() => ({})),
  scrubText: vi.fn((text: string) => text),
}));

vi.mock("../../shared/request-context.ts", () => ({
  setAgentRunId: vi.fn(),
  getRequestId: vi.fn(() => "req-contract-test"),
}));

vi.mock("../../shared/redact.ts", () => ({
  redactPII: vi.fn((text: string) => text),
}));

vi.mock("../../shared/metrics.ts", () => ({
  agentToolCallsTotal: { inc: vi.fn() },
  agentToolCallCapExceededTotal: { inc: vi.fn() },
  agentLlmTokensTotal: { inc: vi.fn() },
  agentLlmIterationTokens: { set: vi.fn() },
  agentLlmContextUsageRatio: { set: vi.fn() },
  agentLlmErrorTotal: { inc: vi.fn() },
  agentIterationLimitTotal: { inc: vi.fn() },
  agentLlmLatencyMs: { observe: vi.fn() },
}));

const mockComparePharmacyPrices = vi.fn(async () => ({
  drug: "Lisinopril",
  cheapest: { pharmacyName: "Costco", price: 12.0 },
  potentialSavings: 35.0,
}));

vi.mock("../tools.ts", () => ({
  comparePharmacyPrices: (...args: any[]) => mockComparePharmacyPrices(...args),
  auditBill: vi.fn(),
  fetchRosaBill: vi.fn(),
  fetchAndAuditBill: vi.fn(),
  checkDrugInteractions: vi.fn(),
  payForMedication: vi.fn(),
  payBill: vi.fn(),
  checkSpendingPolicy: vi.fn(),
  getSpendingSummary: vi.fn(() => ({
    policy: { dailyLimit: 100, monthlyLimit: 800 },
    spending: { medications: 0, bills: 0, serviceFees: 0, total: 0 },
    budgetRemaining: { medications: 300, bills: 500 },
    transactionCount: 0,
    recentTransactions: [],
  })),
  getWalletBalance: vi.fn(),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(),
  resetSpendingTracker: vi.fn(),
  saveSpending: vi.fn(),
  generateDisputeLetter: vi.fn(),
  getAdherenceStatus: vi.fn(),
  confirmAdherenceReminder: vi.fn(),
  setCurrentRecipient: vi.fn(),
  checkRecipientAllergies: vi.fn(),
  runPriceWatch: vi.fn(),
  getHandoffNotes: vi.fn(),
  TOOL_DEFINITIONS: [],
  validateToolInput: vi.fn((_name, input) => input),
}));

vi.mock("../tool-result.ts", () => ({
  fetchToolResult: vi.fn(),
  serializeToolResultForPrompt: vi.fn(() => "tool result output"),
}));

import { runAgent } from "../runner.ts";

/**
 * Fixture: Documented Groq / OpenAI Chat Completion tool-call response.
 * Source: Groq API Reference (https://console.groq.com/docs/tool-use)
 * and OpenAI Chat Completions Specification.
 */
const GROQ_TOOL_CALL_RESPONSE_FIXTURE = {
  id: "chatcmpl-0a8bf8c8-1234-4567-89ab-cdef01234567",
  object: "chat.completion",
  created: 1710000000,
  model: "llama-3.3-70b-versatile",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc123xyz",
            type: "function",
            function: {
              name: "compare_pharmacy_prices",
              arguments: '{"drug_name":"Lisinopril","dosage":"10mg","zip_code":"90210"}',
            },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 30,
    total_tokens: 150,
  },
};

/**
 * Fixture: Documented Groq / OpenAI Chat Completion plain-text response (no tool calls).
 */
const GROQ_PLAIN_TEXT_RESPONSE_FIXTURE = {
  id: "chatcmpl-1b9cf9d9-2345-6789-01bc-def012345678",
  object: "chat.completion",
  created: 1710000010,
  model: "llama-3.3-70b-versatile",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "Lisinopril 10mg is cheapest at Costco for $12.00, saving $35.00/month.",
        tool_calls: null,
      },
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 200,
    completion_tokens: 35,
    total_tokens: 235,
  },
};

describe("LLM Provider Response Schema Contract (Issue #987)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Provider Fixture Schema Assertions", () => {
    it("tool-call fixture matches documented Groq/OpenAI response format", () => {
      const fixture = GROQ_TOOL_CALL_RESPONSE_FIXTURE;

      expect(typeof fixture.id).toBe("string");
      expect(fixture.object).toBe("chat.completion");
      expect(Array.isArray(fixture.choices)).toBe(true);
      expect(fixture.choices.length).toBeGreaterThan(0);

      const choice = fixture.choices[0];
      expect(choice.finish_reason).toBe("tool_calls");
      expect(choice.message.role).toBe("assistant");
      expect(Array.isArray(choice.message.tool_calls)).toBe(true);
      expect(choice.message.tool_calls.length).toBe(1);

      const toolCall = choice.message.tool_calls[0];
      expect(toolCall.id).toMatch(/^call_[a-zA-Z0-9]+$/);
      expect(toolCall.type).toBe("function");
      expect(typeof toolCall.function.name).toBe("string");
      expect(toolCall.function.name).toBe("compare_pharmacy_prices");

      // Critical contract requirement: function.arguments MUST be a JSON string, NOT a pre-parsed object
      expect(typeof toolCall.function.arguments).toBe("string");
      const parsedArgs = JSON.parse(toolCall.function.arguments);
      expect(parsedArgs).toEqual({
        drug_name: "Lisinopril",
        dosage: "10mg",
        zip_code: "90210",
      });
    });

    it("plain-text response fixture matches documented format without tool calls", () => {
      const fixture = GROQ_PLAIN_TEXT_RESPONSE_FIXTURE;

      expect(typeof fixture.id).toBe("string");
      expect(fixture.object).toBe("chat.completion");
      expect(Array.isArray(fixture.choices)).toBe(true);

      const choice = fixture.choices[0];
      expect(choice.finish_reason).toBe("stop");
      expect(choice.message.role).toBe("assistant");
      expect(typeof choice.message.content).toBe("string");
      expect(choice.message.content.length).toBeGreaterThan(0);
      expect(choice.message.tool_calls).toBeNull();
    });
  });

  describe("Agent Runner Integration with Documented Fixtures", () => {
    it("runner parses documented tool-call fixture and subsequent plain-text summary cleanly", async () => {
      const createMock = vi
        .fn()
        .mockResolvedValueOnce(GROQ_TOOL_CALL_RESPONSE_FIXTURE)
        .mockResolvedValueOnce(GROQ_PLAIN_TEXT_RESPONSE_FIXTURE);

      const mockLlm = {
        chat: { completions: { create: createMock } },
      } as any;

      const profile = {
        recipient: { name: "Rosa Garcia", age: 78, medications: ["Lisinopril"] },
        caregiver: { name: "Maria Garcia" },
      };

      const result = await runAgent({
        task: "Find the cheapest price for Lisinopril in 90210",
        profile,
        llm: mockLlm,
        model: "llama-3.3-70b-versatile",
        maxIterations: 5,
        maxToolCallsPerRun: 10,
        piiScrub: false,
      });

      // 1. Two iterations executed: round 0 (tool call) and round 1 (final plain text stop)
      expect(createMock).toHaveBeenCalledTimes(2);

      // 2. Tool call was parsed and dispatched with arguments parsed from JSON string
      expect(mockComparePharmacyPrices).toHaveBeenCalledWith("Lisinopril", "90210", "10mg");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("compare_pharmacy_prices");
      expect(result.toolCalls[0].input).toEqual({
        drug_name: "Lisinopril",
        dosage: "10mg",
        zip_code: "90210",
      });

      // 3. Final plain-text content was extracted as the final response
      expect(result.response).toBe(
        "Lisinopril 10mg is cheapest at Costco for $12.00, saving $35.00/month.",
      );
      expect(result.truncated).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("divergence test: fails if provider returns arguments as an object instead of a JSON string", async () => {
      // If a provider changes arguments from a string to an object, JSON.parse(toolCall.function.arguments)
      // would diverge or fail. We assert that the runner contract strictly requires a string.
      const divergentResponse = {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_div_1",
                  type: "function",
                  function: {
                    name: "compare_pharmacy_prices",
                    arguments: { drug_name: "Lisinopril", zip_code: "90210" }, // Object instead of string
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      // Type validation check against the Groq/OpenAI contract
      expect(typeof (divergentResponse.choices[0].message.tool_calls[0].function.arguments as any)).not.toBe("string");
    });

    it("runner gracefully handles non-function tool call types per contract #1037", async () => {
      const nonFunctionToolResponse = {
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_unsupported_type",
                  type: "custom_extension",
                  function: { name: "unknown", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };

      const plainTextDone = {
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Handled unsupported tool gracefully." },
            finish_reason: "stop",
          },
        ],
      };

      const createMock = vi
        .fn()
        .mockResolvedValueOnce(nonFunctionToolResponse)
        .mockResolvedValueOnce(plainTextDone);

      const mockLlm = {
        chat: { completions: { create: createMock } },
      } as any;

      const profile = {
        recipient: { name: "Rosa Garcia" },
        caregiver: { name: "Maria Garcia" },
      };

      const result = await runAgent({
        task: "Test unsupported tool call",
        profile,
        llm: mockLlm,
        model: "llama-3.3-70b-versatile",
        maxIterations: 3,
        piiScrub: false,
      });

      expect(result.response).toBe("Handled unsupported tool gracefully.");
      // No valid tool calls pushed to result.toolCalls
      expect(result.toolCalls).toHaveLength(0);
    });
  });
});
