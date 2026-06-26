import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync(resolve("agent/server.ts"), "utf8");

describe("LLM error handling — no fabricated summaries", () => {
  it("returns llm_error status on LLM API errors instead of fabricating a summary", () => {
    expect(serverSource).toContain('status: "llm_error"');
    expect(serverSource).toContain("toolCallsCompleted");
  });

  it("does not fabricate success messages from partial tool calls on LLM error", () => {
    expect(serverSource).not.toContain("Paid bill: $");
    expect(serverSource).not.toContain("cheapest at $");
    expect(serverSource).not.toContain("Bill audit: $");
  });

  it("increments agentLlmErrorTotal metric on LLM error", () => {
    expect(serverSource).toContain("agentLlmErrorTotal.inc()");
  });

  it("imports agentLlmErrorTotal from metrics", () => {
    expect(serverSource).toContain("agentLlmErrorTotal");
  });

  it("logs LLM errors with queryable structured fields", () => {
    expect(serverSource).toContain('event: "llm_error"');
    expect(serverSource).toContain("model: LLM_MODEL");
    expect(serverSource).toContain("latency_ms");
    expect(serverSource).toContain("requestId: getRequestId()");
    expect(serverSource).toContain("error,");
  });

  it("records per-call LLM count and latency metrics", () => {
    expect(serverSource).toContain("agentLlmCallsTotal.inc");
    expect(serverSource).toContain("agentLlmLatencySeconds.observe");
    expect(serverSource).toContain('status: "success"');
    expect(serverSource).toContain('status: "error"');
  });
});
