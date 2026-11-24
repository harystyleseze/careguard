# ADR-009: Stop Routing Agent Tool Calls Over HTTP Loopback

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [#1439](https://github.com/harystyleseze/careguard/issues/1439)

## Context

`agent/tools.ts` calls four internal services — PHARMACY_API, BILL_AUDIT_API, DRUG_INTERACTION_API, and PHARMACY_PAYMENT_API — over HTTP using `fetch()`. Each API base URL is configured via an environment variable (`PHARMACY_API_URL`, `BILL_AUDIT_API_URL`, `DRUG_INTERACTION_API_URL`, `PHARMACY_PAYMENT_API_URL`), defaulting to separate localhost ports (3001–3005) for the split-services deployment shape.

In the unified server mode (used by `docker-compose.yml`), all four env vars are set to `http://server:3004` — the same process the agent runs in. This means the agent's tool layer makes an HTTP request that leaves Node, hits the TCP stack, and loops back into the same Express process. The existing ADR 003 (`unified-vs-split-server.md`) documents this trade-off but does not address the loopback cost specifically.

The loopback pattern introduces three costs:
1. **Latency**: A full TCP round-trip (even on loopback) adds ~0.1–0.5ms per call. With multiple tool calls per agent iteration, this accumulates.
2. **Fragility**: The agent can fail with `ENOTFOUND` or `connection-refused` if the unified server's health degrades, even though the code is in the same process.
3. **Observability gap**: HTTP spans for loopback calls pollute traces with meaningless network metadata, making it harder to distinguish real external calls from internal ones.

However, the HTTP path also has benefits: it exercises the full middleware stack (rate limiting, auth, CORS, body parsing), and it keeps the agent decoupled from service implementations.

## Decision

Propose an **in-process transport abstraction** that the agent calls directly when co-located with the services, falling back to HTTP only in the split-services deploy shape.

### Current Loopback Pattern

`agent/tools.ts` (lines 126–132) declares four base URLs:

```ts
const PHARMACY_API = process.env.PHARMACY_API_URL || 'http://localhost:3001';
const BILL_AUDIT_API = process.env.BILL_AUDIT_API_URL || 'http://localhost:3002';
const DRUG_INTERACTION_API = process.env.DRUG_INTERACTION_API_URL || 'http://localhost:3003';
const PHARMACY_PAYMENT_API = process.env.PHARMACY_PAYMENT_API_URL || 'http://localhost:3005';
```

Tool functions call these via three fetch patterns:
- **x402-protected**: `getX402Fetch()\`${BASE_URL}/path\`, { ... })` — wraps fetch with payment protocol
- **MPP-protected**: `getMppClient().fetch(\`${BASE_URL}/path\`, { ... })` — pharmacy payments
- **Free**: plain `fetch(\`${BASE_URL}/path\`)` — e.g. sample bill fetch

### Proposed In-Process Interface

Define a `ServiceClient` interface that mirrors the HTTP route contract:

```ts
interface ServiceClient {
  // Pharmacy pricing
  comparePharmacies(params: CompareParams): Promise<PharmacyCompareResponse>;
  getDrugInfo(drugName: string): Promise<DrugInfo>;

  // Bill audit
  auditBill(lineItems: LineItem[]): Promise<BillAuditResponse>;

  // Drug interactions
  checkInteractions(drugs: string[]): Promise<InteractionCheckResponse>;

  // Pharmacy payment
  createOrder(order: OrderRequest): Promise<OrderResponse>;
}
```

Two implementations:
1. **`InProcessClient`** — calls the Express route handlers directly via `app.handle()` or by extracting the controller logic into callable functions. No HTTP, no network.
2. **`HttpClient`** — the current `fetch()`-based implementation, used when services run as separate processes.

### Transport Selection at Boot

A new env var `SERVICE_TRANSPORT` (default: `auto`) controls which client is used:

| Value | Behavior |
|-------|----------|
| `auto` | If all `*_API_URL` env vars point to `localhost` or `127.0.0.1` (i.e. unified mode), use `InProcessClient`. Otherwise, use `HttpClient`. |
| `in-process` | Force `InProcessClient`. Fail at startup if the service modules aren't importable. |
| `http` | Force `HttpClient`. Always use network calls. |

The `auto` heuristic works because `docker-compose.yml` sets the URLs to `http://server:3004` (not localhost), so the split-services shape always gets HTTP. Local development with the unified server uses `http://localhost:3004`, which matches the in-process heuristic.

### Migration Plan

1. **Phase 1 — Extract callable functions**: Refactor each service's route handlers into pure controller functions that accept typed input and return typed output. The Express routes become thin wrappers that parse the request and delegate to these functions. This is a no-op refactor — behavior is identical.

2. **Phase 2 — Implement `InProcessClient`**: Create `shared/in-process-client.ts` that imports the controller functions and calls them directly. The `ServiceClient` interface abstracts over both implementations.

3. **Phase 3 — Wire transport selection**: In `agent/tools.ts`, replace direct `fetch()` calls with `getServiceClient().comparePharmacies(...)` etc. The client is selected at boot based on `SERVICE_TRANSPORT`.

4. **Phase 4 — Update tests**: Unit tests can use `InProcessClient` for fast, deterministic testing. Integration tests continue to use `HttpClient` to verify the HTTP path.

### Preserving Error Semantics

The `InProcessClient` must produce the same error shapes as the HTTP path:
- HTTP 400 → `ServiceError` with code `VALIDATION_ERROR` and the same message
- HTTP 404 → `ServiceError` with code `NOT_FOUND`
- HTTP 500 → `ServiceError` with code `INTERNAL_ERROR`
- Network error → `ServiceError` with code `NETWORK_ERROR` (only for `HttpClient`)

Existing retry logic (where present) checks `response.ok` and status codes. The `InProcessClient` should throw `ServiceError` objects that carry a `status` field matching what the HTTP path would have returned.

### Testing / Observability Impact

- **Dropped HTTP spans**: In-process calls won't generate OpenTelemetry HTTP spans. This is desirable — it removes noise. A new `SERVICE_CALL` span kind should be used instead.
- **Metrics**: `agent_tool_calls_total` already tracks tool calls by name and status. The transport layer can add a `transport` label (`in-process` vs `http`) to distinguish the two paths.
- **Rate limiting**: In-process calls bypass the HTTP rate limiter. This is acceptable because the rate limiter exists to protect against external abuse, not internal calls. If needed, a token-bucket check can be applied inside `InProcessClient`.

## Consequences

### Positive
- Eliminates loopback latency and `ENOTFOUND`/`connection-refused` failures in unified mode
- Reduces trace noise from meaningless HTTP spans
- Makes local development faster and more reliable
- Preserves full HTTP path for integration testing and split-services deployment

### Negative
- Adds an abstraction layer (`ServiceClient` interface + two implementations) that must stay behaviorally synchronized
- `InProcessClient` bypasses middleware — must manually replicate any middleware behavior that affects response shape (e.g., body size limits are still enforced by Express but won't be by direct function calls)
- A `SERVICE_TRANSPORT` env var adds operational surface area

### Risks
- Behavioral drift between `InProcessClient` and the HTTP route handlers. Mitigated by shared integration tests that run against both transports.
- Import-time side effects in service modules (e.g., starting a database connection) could cause issues when imported in-process. Mitigated by lazy initialization patterns already used in the codebase.

## Compliance

- All agent tool functions must go through `getServiceClient()` — direct `fetch()` calls to internal APIs are forbidden in new code
- `SERVICE_TRANSPORT` must be documented in `.env.example` and the deployment guide
- Integration test suite must include a transport-agnostic test runner that exercises both `InProcessClient` and `HttpClient`
- A `transport` label on `agent_tool_calls_total` metrics is required before merging
