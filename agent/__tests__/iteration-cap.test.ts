/**
 * Tests for MAX_AGENT_ITERATIONS cap handling.
 *
 * Verifies that when an LLM infinitely requests tool calls, the iteration 
 * cap is hit, truncated=true is returned, and the WARN log includes the task.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import OpenAI from "openai";

vi.mock("dotenv/config", () => ({}));
vi.mock("../../shared/audit-log.ts", () => ({ appendAuditEntry: vi.fn() }));
vi.mock("../../shared/cors.ts", () => ({
  createCorsMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../shared/security-middleware.ts", () => ({
  applySecurityMiddleware: vi.fn(),
}));
vi.mock("../../shared/sentry.ts", () => ({
  initSentry: vi.fn(async () => ({
    enabled: false,
    requestHandler: () => (_req: any, _res: any, next: any) => next(),
    errorHandler: () => (err: any, _req: any, _res: any, next: any) => next(err),
    captureException: vi.fn(),
  })),
}));
vi.mock("../../shared/logger.ts", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: "debug",
  },
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../shared/wallet-balance.ts", () => ({
  checkWalletBalance: vi.fn(async () => ({ action: "ok" })),
  formatResult: vi.fn(() => "ok"),
}));
vi.mock("../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  OZ_FACILITATOR_URL: "https://mock.oz",
  DEFAULT_FACILITATOR_URL: "https://mock.oz",
}));
vi.mock("mppx/server", () => ({
  Mppx: { create: vi.fn(() => ({ charge: vi.fn(() => vi.fn()) })) },
  Store: { memory: vi.fn() },
}));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn() } }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "mock-sac" }));
vi.mock("@stellar/stellar-sdk", () => ({
  Keypair: {
    fromSecret: vi.fn(() => ({
      publicKey: () => "GMOCK123",
      secret: () => "SMOCK123",
      sign: vi.fn(),
      signatureHint: () => Buffer.from([0, 0, 0, 0]),
    })),
  },
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Horizon: { Server: vi.fn(() => ({ loadAccount: vi.fn() })) },
  TransactionBuilder: vi.fn(() => ({
    addOperation: vi.fn(),
    setTimeout: vi.fn(() => ({ build: vi.fn(() => ({ sign: vi.fn() })) })),
  })),
  Operation: { payment: vi.fn(() => ({})), changeTrust: vi.fn(() => ({})) },
  Asset: { native: vi.fn(() => ({})), "new ": vi.fn(() => ({})) },
}));

const mockCreate = vi.fn();
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

// Set env vars
process.env.LLM_API_KEY = "test-key";
process.env.AGENT_SECRET_KEY = "SCZANGBA5YHTNYVS23C4QSOT45PZCBL2D4ZO5TSRE73UFYS3FMAJNMX";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
process.env.MPP_SECRET_KEY = "test-mpp-secret";
process.env.CAREGIVER_TOKEN = "test-caregiver-token";
process.env.MOCK_NETWORK = "1";
process.env.MAX_AGENT_ITERATIONS = "5";

import { runAgent } from "../runner.ts";

describe("agent iteration cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hits iteration cap with infinite tool calls and returns truncated=true", async () => {
    // LLM that always returns tool calls, never stops
    mockCreate.mockImplementation(async () => ({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "tc-1",
                type: "function",
                function: { name: "get_spending_summary", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));

    const result = await runAgent({
      task: "Keep calling tools forever",
      profile: {
        recipient: { name: "Rosa Garcia", age: 78, medications: ["Lisinopril"] },
        caregiver: { name: "Maria Garcia" },
      },
      llm: new OpenAI({ apiKey: "test-key" }),
      model: "mock-model",
      maxIterations: 5,
      maxToolCallsPerRun: 100,
      piiScrub: false,
    });

    // Iteration cap at 5 means 5 iterations max
    // Each iteration has 1 tool call, so toolCalls should be 5
    expect(result.truncated).toBe(true);
    expect(result.toolCalls).toHaveLength(5);
    expect(result.events.some((e) => e.kind === "iteration_limit_reached")).toBe(true);
  });

  it("does not truncate when task completes before iteration limit", async () => {
    // Returns tool calls once, then stops
    let calls = 0;
    mockCreate.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "tc-1",
                    type: "function",
                    function: { name: "get_spending_summary", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        };
      }
      return {
        choices: [
          {
            message: { role: "assistant", content: "Done.", tool_calls: [] },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      };
    });

    const result = await runAgent({
      task: "Do one thing and stop",
      profile: {
        recipient: { name: "Rosa Garcia", age: 78, medications: ["Lisinopril"] },
        caregiver: { name: "Maria Garcia" },
      },
      llm: new OpenAI({ apiKey: "test-key" }),
      model: "mock-model",
      maxIterations: 10,
      maxToolCallsPerRun: 100,
      piiScrub: false,
    });

    expect(result.truncated).toBe(false);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.events.some((e) => e.kind === "iteration_limit_reached")).toBe(false);
  });
});
