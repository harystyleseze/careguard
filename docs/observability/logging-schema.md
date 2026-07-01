# Structured Logging Schema

All CareGuard services log via the shared Pino logger in `shared/logger.ts`. Logs are emitted as newline-delimited JSON in production and as human-readable output via `pino-pretty` in development.

---

## Standard Log Entry Fields

Every log entry contains the following core fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `level` | `number` | Pino severity level (`10`=trace, `20`=debug, `30`=info, `40`=warn, `50`=error, `60`=fatal) | `30` |
| `time` | `number` | Unix epoch milliseconds | `1719334800000` |
| `pid` | `number` | Process ID | `12345` |
| `hostname` | `string` | Machine hostname | `careguard-api-1` |
| `msg` | `string` | Human-readable log message | `Agent run completed` |
| `requestId` | `string` | UUID scoped to one HTTP request (see `request-context.ts`) | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `agentRunId` | `string` | UUID scoped to one agent invocation (present during `runAgent`) | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `service` | `string` | Service name (added by each service's logger child) | `pharmacy-api` |
| `name` | `string` | Logger name (set via `pino({ name })`) | `agent` |

### Optional Fields

| Field | Description |
|-------|-------------|
| `err` | Error object serialized with `message`, `stack`, and `type` |
| `task` | Agent task description string (truncated to 100 chars — see below) |
| `model` | LLM model identifier used for the request |
| `duration_ms` | Duration of the logged operation in milliseconds |

---

## Log Level Control

Set the `LOG_LEVEL` environment variable to change the minimum log level:

```bash
LOG_LEVEL=debug node --import tsx server.ts
```

Defaults to `info` when unset. Available levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.

---

## Redaction Guarantees

### Path-Based Redaction

The following fields are automatically redacted (replaced with `[REDACTED]`) in all log output:

- `authorization`
- `req.headers.authorization`
- `AGENT_SECRET_KEY`
- `LLM_API_KEY`
- `OZ_FACILITATOR_API_KEY`
- `MPP_SECRET_KEY`
- Any field ending in `.secret` or `.apiKey`

### Stellar Key Pattern Redaction

Any string value matching `S[A-Z2-7]{55}` (Stellar secret key format) is automatically replaced with `[STELLAR-KEY-REDACTED]` across all log fields. This is applied at the formatter level in `shared/logger.ts:38-41`.

```typescript
// shared/logger.ts lines 4-8
const STELLAR_KEY_RE = /S[A-Z2-7]{55}/g;
function sanitize(v: unknown): unknown {
  return typeof v === "string" ? v.replace(STELLAR_KEY_RE, "[STELLAR-KEY-REDACTED]") : v;
}
```

> **Note:** The sanitizer runs on all string values in the log object via the `formatters.log` hook. It does not recurse into nested objects — Pino handles serialization of nested fields separately.

### Task Truncation

The `task` serializer truncates agent task strings to 100 characters:

```typescript
// shared/logger.ts lines 33-36
serializers: {
  task: (v: unknown) =>
    typeof v === "string" ? v.slice(0, 100) + "…" : v,
},
```

---

## Production vs Development

| Environment | Transport | Format |
|-------------|-----------|--------|
| Production (`NODE_ENV=production`) | Default (no transport) | Newline-delimited JSON to stdout |
| Development (any other value) | `pino-pretty` | Colorized human-readable output |

The transport is configured in `shared/logger.ts:42-45`:

```typescript
transport:
  process.env.NODE_ENV !== "production"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
```

In production, ingest logs via your preferred log collector (e.g., stdout to Datadog, Logtail, ELK, or a sidecar fluentd).

---

## Correlating Logs

### By `requestId`

Every HTTP request receives a UUID (`requestId`) set by `requestContextMiddleware` in `shared/request-context.ts`. All logs emitted during that request's lifecycle carry the same `requestId`.

```bash
# Example: grep all logs for a specific request
grep '"requestId":"a1b2c3d4-e5f6-7890-abcd-ef1234567890"' careguard.log

# jq filter
jq 'select(.requestId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")' careguard.log
```

### By `agentRunId`

When the agent processes a request, `setAgentRunId()` in `shared/request-context.ts` attaches a run-specific UUID. This links all tool calls, LLM interactions, and payments for that agent run.

```bash
# Find all logs for a specific agent run
jq 'select(.agentRunId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")' careguard.log
```

### Combined query

```bash
jq 'select(.requestId == "REQ-123" and .agentRunId == "RUN-456")' careguard.log
```

---

## Example Log Entries

### Info (agent run started)

```json
{"level":30,"time":1719334800000,"pid":1,"hostname":"careguard-api","msg":"Agent run started","requestId":"550e8400-e29b-41d4-a716-446655440000","agentRunId":"660e8400-e29b-41d4-a716-446655440001","service":"agent"}
```

### Error (LLM API failure)

```json
{"level":50,"time":1719334801000,"pid":1,"hostname":"careguard-api","msg":"LLM API error","requestId":"550e8400-e29b-41d4-a716-446655440000","agentRunId":"660e8400-e29b-41d4-a716-446655440001","service":"agent","err":{"message":"429 Too Many Requests","stack":"Error: 429 Too Many Requests\n    at ...","type":"Error"}}
```

### Debug (tool call)

```json
{"level":20,"time":1719334802000,"pid":1,"hostname":"careguard-api","msg":"Executing tool","requestId":"550e8400-e29b-41d4-a716-446655440000","agentRunId":"660e8400-e29b-41d4-a716-446655440001","service":"agent","task":"Comparing pharmacy prices for Metformin 500mg 30-day supply…","tool":"pharmacy_compare"}
```

Notice the `task` field is truncated to 100 characters.

---

## Security & Audit

See [docs/SECURITY.md](../SECURITY.md) for details on log tampering detection and audit log integrity guarantees.

## Related

- [Grafana dashboard guide](./dashboard-guide.md) — metrics and panels
- [Correlation ID design](../adr/002-pii-in-persistence.md) — PII and request tracing decisions
