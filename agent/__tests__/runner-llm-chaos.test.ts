/**
 * Chaos tests for LLM provider outage during agent run loop (Issue #807).
 * Verifies explicit error handling and bounded timeouts for LLM failures.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";

const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
const mockAudit = vi.fn();

vi.mock("../../shared/logger.ts", () => ({
  logger: mockLogger,
}));

vi.mock("../../shared/audit-log.ts", () => ({
  appendAuditEntry: mockAudit,
}));

vi.mock("../../shared/prompt-scrub.ts", () => ({
  buildScrubSession: vi.fn(() => ({})),
  scrubText: vi.fn((text) => text),
}));

vi.mock("../../shared/request-context.ts", () => ({
  setAgentRunId: vi.fn(),
  getRequestId: vi.fn(() => "req-123"),
}));

vi.mock("../../shared/redact.ts", () => ({
  redactPII: vi.fn((text) => text),
}));

vi.mock("../../shared/metrics.ts", () => ({
  agentToolCallsTotal: { inc: vi.fn() },
  agentLlmTokensTotal: { inc: vi.fn() },
  agentLlmIterationTokens: { set: vi.fn() },
  agentLlmContextUsageRatio: { set: vi.fn() },
  agentLlmErrorTotal: { inc: vi.fn() },
  agentIterationLimitTotal: { inc: vi.fn() },
  agentLlmLatencyMs: { set: vi.fn() },
}));

vi.mock("../../agent/tools.ts", () => ({
  comparePharmacyPrices: vi.fn(),
  auditBill: vi.fn(),
  fetchRosaBill: vi.fn(),
  fetchAndAuditBill: vi.fn(),
  checkDrugInteractions: vi.fn(),
  payForMedication: vi.fn(),
  payBill: vi.fn(),
  checkSpendingPolicy: vi.fn(),
  getSpendingSummary: vi.fn(() => ({})),
  getWalletBalance: vi.fn(),
  setSpendingPolicy: vi.fn(),
  getSpendingTracker: vi.fn(),
  resetSpendingTracker: vi.fn(),
  saveSpending: vi.fn(),
  generateDisputeLetter: vi.fn(),
  getAdherenceStatus: vi.fn(),
  confirmAdherenceReminder: vi.fn(),
  setCurrentRecipient: vi.fn(),
  TOOL_DEFINITIONS: [],
  validateToolInput: vi.fn((name, input) => input),
}));

vi.mock("../../agent/tool-result.ts", () => ({
  fetchToolResult: vi.fn(),
  serializeToolResultForPrompt: vi.fn(() => "tool result"),
}));

import { runAgent } from "../../agent/runner.ts";

describe("LLM runner — outage chaos (Issue #807)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("LLM 5xx error at iteration 0 returns explicit error result", async () => {
    const failingLlm = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error("Error 500: Internal Server Error");
          }),
        },
      },
    } as any;

    const profile = {
      recipient: { name: "Rosa", age: 72, medications: ["metformin"] },
      caregiver: { name: "John" },
    };

    const result = await runAgent({
      task: "check medication prices",
      profile,
      llm: failingLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("500");
    expect(result.response).toContain("partial");
  });

  it("LLM timeout returns bounded error, does not hang indefinitely", async () => {
    const timeoutLlm = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            await new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Request timeout")), 100)
            );
          }),
        },
      },
    } as any;

    const profile = {
      recipient: { name: "Rosa", age: 72, medications: ["metformin"] },
      caregiver: { name: "John" },
    };

    const start = Date.now();
    const result = await runAgent({
      task: "check medication prices",
      profile,
      llm: timeoutLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });
    const elapsed = Date.now() - start;

    expect(result.error).toBeDefined();
    expect(elapsed).toBeLessThan(5000);
  });

  it("LLM connection-refused returns explicit error, not empty summary", async () => {
    const refusedLlm = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error("ECONNREFUSED: Connection refused");
          }),
        },
      },
    } as any;

    const profile = {
      recipient: { name: "Rosa", age: 72, medications: ["metformin"] },
      caregiver: { name: "John" },
    };

    const result = await runAgent({
      task: "check medication prices",
      profile,
      llm: refusedLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("ECONNREFUSED");
    expect(result.response).toContain("error");
  });

  it("error is logged as degraded-mode event", async () => {
    const failingLlm = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new Error("Error 503: Service Unavailable");
          }),
        },
      },
    } as any;

    const profile = {
      recipient: { name: "Rosa", age: 72, medications: ["metformin"] },
      caregiver: { name: "John" },
    };

    const result = await runAgent({
      task: "check medication prices",
      profile,
      llm: failingLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toHaveProperty("iteration");
  });

  it("recovery: subsequent run after provider returns succeeds", async () => {
    let providerDown = true;

    const recoveringLlm = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            if (providerDown) {
              throw new Error("Error 500: Internal Server Error");
            }
            return {
              choices: [
                {
                  message: { content: "Success" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          }),
        },
      },
    } as any;

    const profile = {
      recipient: { name: "Rosa", age: 72, medications: ["metformin"] },
      caregiver: { name: "John" },
    };

    const failedRun = await runAgent({
      task: "check medication prices",
      profile,
      llm: recoveringLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });

    expect(failedRun.error).toBeDefined();

    providerDown = false;

    const successRun = await runAgent({
      task: "check medication prices",
      profile,
      llm: recoveringLlm,
      model: "gpt-4",
      maxIterations: 5,
      maxToolCallsPerRun: 10,
      llmToolTemperature: 0.3,
      llmSummaryTemperature: 0.5,
      llmMaxTokensToolResult: 2000,
      llmMaxTokensSimple: 500,
      llmMaxTokensSummary: 800,
      llmContextWindow: 8000,
    });

    expect(successRun.error).toBeUndefined();
  });
});
