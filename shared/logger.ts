// pino/pino-pretty version pairing (issue #1394): pino-pretty's major is
// independent of pino's. `pino ^10.3.1` (runtime) pairs with the current
// `pino-pretty ^13.1.3` (dev-time formatter, used only via the transport
// below when NODE_ENV !== "production"). Bump both together and re-verify
// pretty dev logs. See docs/tech-stack.md → "Dependency version pairing".
import pino from "pino";
import { getRequestId, getAgentRunId } from "./request-context.ts";

const STELLAR_KEY_RE = /S[A-Z2-7]{55}/g;

// Recursively scrubs Stellar secret keys from nested objects and arrays (#1040).
// Mirrors the depth-8 guard in shared/redact.ts's redact() to avoid pathological inputs.
function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 8) return v;
  if (typeof v === "string") return v.replace(STELLAR_KEY_RE, "[STELLAR-KEY-REDACTED]");
  if (Array.isArray(v)) return v.map((item) => sanitize(item, depth + 1));
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return v;
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
