import pino from "pino";
import { getRequestId, getAgentRunId } from "./request-context.ts";

const STELLAR_KEY_RE = /S[A-Z2-7]{55}/g;

function sanitize(v: unknown): unknown {
  return typeof v === "string" ? v.replace(STELLAR_KEY_RE, "[STELLAR-KEY-REDACTED]") : v;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  mixin() {
    const requestId = getRequestId();
    const agentRunId = getAgentRunId();
    const ctx: Record<string, string> = {};
    if (requestId) ctx.requestId = requestId;
    if (agentRunId) ctx.agentRunId = agentRunId;
    return ctx;
  },
  redact: {
    paths: [
      "authorization",
      "req.headers.authorization",
      "AGENT_SECRET_KEY",
      "LLM_API_KEY",
      "OZ_FACILITATOR_API_KEY",
      "MPP_SECRET_KEY",
      "*.secret",
      "*.apiKey",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    task: (v: unknown) =>
      typeof v === "string" ? v.slice(0, 100) + "…" : v,
  },
  formatters: {
    log(obj) {
      return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitize(v)]));
    },
  },
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export const log = logger;
