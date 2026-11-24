# ADR-011: Extract a Shared Server-Bootstrap Module

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [#1440](https://github.com/harystyleseze/careguard/issues/1440)

## Context

CareGuard has six server entrypoints that each independently import and wire the same middleware modules:

- `server.ts` (unified, port 3004)
- `agent/server.ts` (standalone agent, port 3004)
- `services/pharmacy-api/server.ts` (port 3001)
- `services/bill-audit-api/server.ts` (port 3002)
- `services/drug-interaction-api/server.ts` (port 3003)
- `services/pharmacy-payment/server.ts` (port 3005)

Each entrypoint imports `createCorsMiddleware` from `shared/cors.ts`, `rateLimiters`/`perRouteLimiters` from `shared/rate-limit.ts`, and `applySecurityMiddleware` from `shared/security-middleware.ts`, then wires them in its own order with its own defaults. This copy-pasted wiring can silently drift between services.

### Current Middleware Wiring Per Entrypoint

| Middleware | Unified `server.ts` | Agent `server.ts` | pharmacy-api | bill-audit-api | drug-interaction | pharmacy-payment |
|---|---|---|---|---|---|---|
| Rate limiters | First (before Sentry) | After API key auth | None | None | None | None |
| Sentry | Before security | None | None | None | None | None |
| Security headers | After Sentry | After CORS | First | First | First | First |
| CORS | After security | After security | After security | After security | After security | After security |
| Body parser | After CORS | After CORS | After CORS | After CORS (256kb) | After CORS | After CORS |
| Request context | After body | After body | After body | After body | After body | After body |
| Request logger | After context | After context | After context | After context | After context | After context |
| API key auth | On `/agent` route | On `/agent` (first) | None | None | None | None |
| Metrics endpoint | Yes (`/metrics`) | Yes (`/metrics`) | No | No | No | No |

### Divergences

1. **Rate limiting**: Only `server.ts` and `agent/server.ts` have rate limiters. The four standalone service servers have no rate limiting at all.
2. **Sentry**: Only `server.ts` initializes Sentry.
3. **API key auth order**: `agent/server.ts` applies `requireApiKey` before everything (even rate limiters). The unified server applies it after security/CORS/body-parser.
4. **Metrics endpoint**: Only `server.ts` and `agent/server.ts` expose `/metrics`.
5. **Middleware order**: Standalone services all follow Security → CORS → JSON → Context → Logger. The unified server inserts Sentry between rate limiters and security.

## Decision

Propose a shared `createServiceApp(options)` bootstrap helper in `shared/` that composes the standard middleware stack in one place, with per-service overrides passed as options.

### Proposed API

```ts
interface ServiceAppOptions {
  /** Service name for logging and metrics labels. Required. */
  serviceName: string;

  /** Port to listen on. Default: 3000 */
  port?: number;

  /** Enable rate limiting. Default: true */
  enableRateLimiting?: boolean;

  /** Per-route rate limit overrides. Default: {} */
  rateLimitOverrides?: Record<string, { windowSeconds: number; max: number }>;

  /** Enable Sentry request/error handling. Default: false */
  enableSentry?: boolean;

  /** Enable metrics endpoint at /metrics. Default: false */
  enableMetrics?: boolean;

  /** Custom body parser size limit. Default: '20kb' */
  bodyLimit?: string;

  /** CORS allowed origins override. Default: from env */
  allowedOrigins?: string[];

  /** Additional middleware to apply after the standard stack. */
  extraMiddleware?: Express[];

  /** Additional routes to mount after the standard stack. */
  routes?: { path: string; handler: Router }[];
}

function createServiceApp(options: ServiceAppOptions): Express;
```

### Fixed vs. Overridable

| Aspect | Fixed (not overridable) | Overridable via options |
|--------|------------------------|------------------------|
| Security headers (helmet) | Always applied, standard CSP | No |
| Request context | Always applied | No |
| Request logger | Always applied | No |
| Middleware ordering | Always: Security → CORS → Body → Context → Logger | No |
| Rate limiting | — | `enableRateLimiting` (default: true) |
| Sentry | — | `enableSentry` (default: false) |
| Metrics | — | `enableMetrics` (default: false) |
| Body parser limit | — | `bodyLimit` (default: '20kb') |
| CORS origins | — | `allowedOrigins` (default: from env) |
| API key auth | — | Applied via `extraMiddleware` per-route |
| Extra middleware | — | `extraMiddleware` array |

### Standardized Middleware Order

All services will follow this fixed order:

```
1. Sentry request handler (if enableSentry)
2. Rate limiters (if enableRateLimiting)
3. Security headers (helmet)
4. CORS
5. Body parser (with configurable limit)
6. Request context
7. Request logger
8. Extra middleware (per-service)
9. Routes (per-service)
10. 413 error handler
11. Sentry error handler (if enableSentry)
```

This resolves the current divergence: the unified server's Sentry placement, the agent server's early API key auth, and the standalone services' missing rate limiters all get normalized.

### Migration Plan

1. **Phase 1 — Create `shared/create-service-app.ts`**: Implement the `createServiceApp()` function with all options. Write unit tests verifying the middleware stack order.

2. **Phase 2 — Pilot with `services/pharmacy-api/server.ts`**: This service has the simplest wiring (no Sentry, no rate limiting, no metrics). Convert it to use `createServiceApp()`. Verify behavior is identical.

3. **Phase 3 — Migrate remaining standalone services**: Convert `bill-audit-api`, `drug-interaction-api`, and `pharmacy-payment` to use `createServiceApp()`. These are all structurally identical to `pharmacy-api`.

4. **Phase 4 — Migrate `agent/server.ts`**: Convert the agent server. This requires handling the early `requireApiKey` placement — move it to `extraMiddleware` or apply it as a route-level middleware on `/agent`.

5. **Phase 5 — Migrate `server.ts` (unified)**: Convert the unified server. This is the most complex due to Sentry, metrics, and the conditional body parser size for `/bill/audit`. The `bodyLimit` option can be a function that inspects the request path.

### Entrypoints to Update

| Entrypoint | Complexity | Notes |
|---|---|---|
| `services/pharmacy-api/server.ts` | Low | Simplest wiring, no special middleware |
| `services/bill-audit-api/server.ts` | Low | Same as pharmacy-api, but needs 256kb body limit |
| `services/drug-interaction-api/server.ts` | Low | Same as pharmacy-api |
| `services/pharmacy-payment/server.ts` | Low | Same as pharmacy-api |
| `agent/server.ts` | Medium | Has rate limiters + early API key auth |
| `server.ts` (unified) | High | Has Sentry + metrics + conditional body limit |

## Consequences

### Positive
- Eliminates copy-pasted middleware wiring that can silently drift
- New services get rate limiting, security headers, and context by default
- Middleware ordering is standardized — easier to reason about request lifecycle
- Reduces boilerplate in each server entrypoint (~20 lines removed per service)

### Negative
- Less flexibility for a service to diverge from convention — must use `extraMiddleware` or `options` for customization
- The `createServiceApp()` function becomes a critical path — bugs affect all services
- Existing standalone services currently have no rate limiting; adding it may break clients that rely on unlimited internal calls

### Risks
- Rate limiting on standalone services could break internal service-to-service calls. Mitigated by using a separate rate limit key prefix for internal calls, or by disabling rate limiting for requests from `127.0.0.1`.
- The unified server's conditional body parser (`256kb` for `/bill/audit`, `20kb` elsewhere) is hard to express in a simple `bodyLimit` option. Mitigated by accepting a function `(req) => string` for `bodyLimit`.

## Compliance

- All new services must use `createServiceApp()` — direct middleware wiring is forbidden
- The middleware order in `createServiceApp()` is the canonical order — PRs that reorder it require ADR review
- Rate limiting must be enabled by default for all services — disabling it requires an explicit `enableRateLimiting: false` option with a comment explaining why
- Sentry and metrics remain opt-in per service — no enforcement until a future ADR decides to enable them globally
