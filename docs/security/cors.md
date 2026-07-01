# CORS Configuration

## Overview

Cross-Origin Resource Sharing (CORS) is configured via `shared/cors.ts`. The middleware restricts which origins can make requests to the CareGuard API.

## Configuration

### Primary: `DASHBOARD_ORIGIN`

Set `DASHBOARD_ORIGIN` in the environment to the exact dashboard origin:

```
DASHBOARD_ORIGIN=https://careguard.example.com
```

When set, this is the **only** origin allowed. No other origins can make cross-origin requests.

### Fallback: `ALLOWED_ORIGINS`

A comma-separated list of origins:

```
ALLOWED_ORIGINS=https://app.careguard.example.com,https://admin.careguard.example.com
```

### Default (no env vars)

When neither `DASHBOARD_ORIGIN` nor `ALLOWED_ORIGINS` is set, the middleware allows:

| Origin | Purpose |
|--------|---------|
| `http://localhost:3000` | Local Next.js dev server |
| `$PROD_URL` | Production URL (if set) |
| `$DASHBOARD_URL` | Dashboard URL (if set) |

## Security Rules

1. **Never use `*`** — even in development, use the explicit dev origin `http://localhost:3000`.
2. **Single origin is preferred** — use `DASHBOARD_ORIGIN` for production deployments.
3. **Credentials are enabled** — `credentials: true` allows cookies and auth headers.

## Testing

- Same-origin requests (Origin matches allowlist) → `200` with CORS headers
- Foreign-origin requests (Origin not in allowlist) → response with no `Access-Control-Allow-Origin` header (browser blocks)

## Relevant Files

- `shared/cors.ts` — CORS middleware implementation
- `server.ts:246` — Middleware registration
