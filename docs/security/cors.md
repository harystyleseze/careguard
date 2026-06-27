# CORS Origin Policy

CareGuard exposes payment-capable `/agent/*` endpoints. Browser access must be limited to the trusted caregiver dashboard origin so an unrelated site cannot trigger paid agent activity from a caregiver session.

## Configuration

Set one of these environment variables on every API deployment:

| Variable | Use |
| --- | --- |
| `ALLOWED_ORIGINS` | Comma-separated allowlist for multiple dashboard origins. Takes precedence when set. |
| `DASHBOARD_ORIGIN` | Single trusted dashboard origin for the common one-dashboard deployment. |
| `PROD_URL` / `DASHBOARD_URL` | Legacy fallback aliases used only when both variables above are unset. |

Local development should still use an explicit origin:

```env
DASHBOARD_ORIGIN=http://localhost:3000
```

Production should point at the deployed dashboard:

```env
DASHBOARD_ORIGIN=https://careguard.example.com
```

Staging plus production can use the allowlist:

```env
ALLOWED_ORIGINS=https://careguard.example.com,https://staging-careguard.example.com
```

## Rules

- Never set `ALLOWED_ORIGINS=*` or `DASHBOARD_ORIGIN=*`; the server rejects wildcard origins at startup.
- Requests with no `Origin` header are allowed for server-to-server and health-check calls.
- Browser requests from origins outside the allowlist receive no `Access-Control-Allow-Origin` header, so the browser blocks access to the response.
- Caregiver auth is expected to be sent as an explicit bearer token. If cookie-based auth is introduced later, use `SameSite=Strict` cookies and add CSRF token verification before enabling credentialed browser calls.

## Verification

Run the CORS regression tests after changing this policy:

```sh
npm test -- shared/__tests__/cors.test.ts
```
