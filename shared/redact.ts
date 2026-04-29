/**
 * Secret and PII redaction helpers.
 *
 * Used by Sentry beforeSend (and any other transport that ships logs/errors
 * off-box) to strip values that must never leave the process: Stellar secret
 * seeds (S...), agent task strings (may contain PII), API keys, and a known
 * set of env-var-shaped fields.
 *
 * Conservative by design — when in doubt, redact.
 */

const REDACTED = "[REDACTED]";

const SECRET_FIELD_NAMES = new Set([
  "task",
  "AGENT_SECRET_KEY",
  "agent_secret_key",
  "agentSecretKey",
  "MPP_SECRET_KEY",
  "mpp_secret_key",
  "mppSecretKey",
  "LLM_API_KEY",
  "llm_api_key",
  "llmApiKey",
  "OZ_FACILITATOR_API_KEY",
  "oz_facilitator_api_key",
  "ozFacilitatorApiKey",
  "CAREGIVER_SECRET_KEY",
  "PHARMACY_1_SECRET_KEY",
  "PHARMACY_2_SECRET_KEY",
  "PHARMACY_3_SECRET_KEY",
  "BILL_PROVIDER_SECRET_KEY",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
  "Set-Cookie",
  "x-api-key",
  "X-Api-Key",
]);

// Stellar secret seeds: S followed by 55 base32 chars
const STELLAR_SECRET_RE = /\bS[A-Z2-7]{55}\b/g;
// Bearer tokens / JWT-ish
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._\-+/=]{20,}\b/gi;

export function redactString(value: string): string {
  return value.replace(STELLAR_SECRET_RE, REDACTED).replace(BEARER_RE, `Bearer ${REDACTED}`);
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (value == null) return value;
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_FIELD_NAMES.has(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out as unknown as T;
  }
  return value;
}
