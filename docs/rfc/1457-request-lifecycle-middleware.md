# RFC 1457: Merge `shared/request-context.ts` and `shared/request-logger.ts` into one `request-lifecycle` middleware

**Status:** Proposed / Implemented  
**Date:** 2026-08-27  
**Issue:** [#1457](https://github.com/harystyleseze/careguard/issues/1457)  

---

## Context

Currently, server entrypoints must import and mount both `requestContextMiddleware` and `requestLoggerMiddleware` as separate steps in a fixed sequence:
```ts
app.use(requestContextMiddleware());
app.use(requestLoggerMiddleware());
```
Because request logging relies on `AsyncLocalStorage` and `req.requestId` populated by `requestContextMiddleware`, the two modules are functionally coupled. Mounting them out of order or omitting context setup breaks request correlation IDs in log outputs.

This RFC proposes combining context initialization and logging into a single order-safe `requestLifecycleMiddleware()` in `shared/request-lifecycle.ts` with a double-mount detection guard.

---

## Acceptance Criteria

### 1. Confirm Ordering Dependency Across Entrypoints

Across all 6 server entrypoints (`server.ts`, `agent/server.ts`, `services/pharmacy-api/server.ts`, `services/bill-audit-api/server.ts`, `services/drug-interaction-api/server.ts`, `services/pharmacy-payment/server.ts`), `requestContextMiddleware` was mounted immediately before `requestLoggerMiddleware`. If mounted in reverse or if one middleware were omitted, logging would fail to correlate requests with request IDs.

### 2. Single Combined Middleware Proposal

Create `shared/request-lifecycle.ts` exposing `requestLifecycleMiddleware()`:
```ts
export function requestLifecycleMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req._requestLifecycleMounted) {
      throw new Error("requestLifecycleMiddleware mounted more than once on request");
    }
    req._requestLifecycleMounted = true;

    const id = (req.headers["x-request-id"] as string | undefined) || randomUUID();
    req.requestId = id;
    res.setHeader("X-Request-ID", id);

    const start = Date.now();
    res.on("finish", () => {
      const duration_ms = Date.now() - start;
      const { method } = req;
      const path = req.path || req.url;
      const status = res.statusCode;
      const data = { method, path, status, duration_ms };

      if (status >= 500) {
        log.error(data, "http");
      } else if (status >= 400 && SENSITIVE_PATHS.has(path)) {
        log.warn(data, "http");
      } else {
        log.info(data, "http");
      }
    });

    als.run({ requestId: id }, () => next());
  };
}
```

### 3. Migration Plan Updating 6 Server Entrypoints

Update every entrypoint to import `requestLifecycleMiddleware` from `shared/request-lifecycle.ts` and mount it once:
```ts
app.use(requestLifecycleMiddleware());
```
Server entrypoints updated:
1. `server.ts`
2. `agent/server.ts`
3. `services/pharmacy-api/server.ts`
4. `services/bill-audit-api/server.ts`
5. `services/drug-interaction-api/server.ts`
6. `services/pharmacy-payment/server.ts`

For backward compatibility, `requestContextMiddleware` and `requestLoggerMiddleware` in `shared/request-context.ts` and `shared/request-logger.ts` remain available and delegate to `requestLifecycleMiddleware()`.

### 4. Guard and Test for Duplicate Mount

A guard flag `req._requestLifecycleMounted` throws an explicit error if `requestLifecycleMiddleware` is mounted twice on the same request object. Unit tests in `shared/__tests__/request-lifecycle.test.ts` verify context creation, logging, header propagation, and double-mount detection.

### 5. Correlation ID Consumers Independent of Logging

The following components consume correlation IDs via `getRequestId()` or `getAgentRunId()` independently of request logging:
- `shared/logger.ts` (attaches `requestId` to log entries if active context exists)
- `shared/audit-log.ts` (records `requestId` on audit events)
- `agent/runner.ts` (sets and reads `agentRunId` in `AsyncLocalStorage`)
All context helper functions (`getRequestId`, `getAgentRunId`, `setAgentRunId`, `withRequestContext`) are preserved and re-exported.
