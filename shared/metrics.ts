/**
 * Shared prom-client registry for all CareGuard servers.
 *
 * Uses a custom Registry (not the global default) so multiple test
 * suites can import this module without double-registration conflicts.
 *
 * IMPORTANT: Import this module — never require() it dynamically or
 * use vm.Module, as that would create a second Registry instance.
 */

import { Registry, Counter, Gauge, collectDefaultMetrics } from "prom-client";
import type { RequestHandler } from "express";

export const registry = new Registry();

// Default Node.js process metrics (event-loop lag, heap, handles, GC)
collectDefaultMetrics({ register: registry });

export const agentRunsTotal = new Counter({
  name: "agent_runs_total",
  help: "Total agent run attempts",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const agentToolCallsTotal = new Counter({
  name: "agent_tool_calls_total",
  help: "Total tool calls executed by the agent",
  labelNames: ["tool", "status"] as const,
  registers: [registry],
});

export const paymentsUsdcTotal = new Counter({
  name: "payments_usdc_total",
  help: "Total USDC payments made",
  labelNames: ["type"] as const,
  registers: [registry],
});

export const x402SettlementsTotal = new Counter({
  name: "x402_settlements_total",
  help: "Total x402 protocol settlements",
  registers: [registry],
});

export const stellarTxSubmittedTotal = new Counter({
  name: "stellar_tx_submitted_total",
  help: "Total Stellar transactions submitted",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const policyBlocksTotal = new Counter({
  name: "policy_blocks_total",
  help: "Total spending policy blocks",
  labelNames: ["reason"] as const,
  registers: [registry],
});

export const agentLlmTokensTotal = new Counter({
  name: "agent_llm_tokens_total",
  help: "Total LLM tokens consumed",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const agentLlmIterationTokens = new Gauge({
  name: "agent_llm_iteration_tokens",
  help: "LLM tokens consumed in the latest iteration",
  labelNames: ["kind"] as const,
  registers: [registry],
});

export const agentLlmContextUsageRatio = new Gauge({
  name: "agent_llm_context_usage_ratio",
  help: "Latest agent LLM iteration token usage ratio versus model context window",
  registers: [registry],
});

export const agentSpendingUsd = new Gauge({
  name: "agent_spending_usd",
  help: "Total USD spent by category",
  labelNames: ["category"] as const,
  registers: [registry],
});

export const agentTransactionsTotal = new Counter({
  name: "agent_transactions_total",
  help: "Total transactions by status",
  labelNames: ["status"] as const,
  registers: [registry],
});

export const agentSseClients = new Gauge({
  name: "agent_sse_clients",
  help: "Currently connected /agent/stream SSE clients",
  registers: [registry],
});

export const agentLlmErrorTotal = new Counter({
  name: "agent_llm_error_total",
  help: "Total LLM API errors during agent runs",
  registers: [registry],
});

export function metricsHandler(): RequestHandler {
  return async (req, res) => {
    const token = process.env.METRICS_TOKEN;
    if (token) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${token}`) {
        res.status(401).setHeader("WWW-Authenticate", "Bearer").send("Unauthorized");
        return;
      }
    }
    res.set("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  };
}
