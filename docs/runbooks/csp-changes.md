# Runbook: Updating the Content-Security-Policy

## Overview

CareGuard's CSP is defined in `shared/security-middleware.ts` and mounted on every Express app before routes. Any time a new external service is added (LLM provider, payment facilitator, Stellar network endpoint), the CSP `connect-src` directive must be updated.

## Current Policy

```
default-src 'self'
connect-src 'self'
           https://horizon-testnet.stellar.org
           https://channels.openzeppelin.com
           https://api.groq.com
```

## When to Update

| Trigger | What to change |
|---------|---------------|
| New LLM provider (e.g. OpenAI, OpenRouter) | Add provider base URL to `connect-src` |
| New Stellar network endpoint (mainnet) | Add `https://horizon.stellar.org` to `connect-src` |
| New x402 facilitator URL | Add to `connect-src` |
| New external API called from browser | Add to `connect-src` |
| Dashboard loads fonts/images from CDN | Add CDN to `font-src` / `img-src` |

## How to Update

1. **Edit `shared/security-middleware.ts`** — add the new origin to the relevant directive:

   ```ts
   connectSrc: [
     "'self'",
     "https://horizon-testnet.stellar.org",
     "https://channels.openzeppelin.com",
     "https://api.groq.com",
     "https://new-service.example.com",   // ← add here
   ],
   ```

2. **Update the test** in `shared/__tests__/security-middleware.test.ts` to assert the new entry is present in the CSP header.

3. **Update this file** — add a row to the table above.

4. **Deploy** — the change takes effect on server restart. No client-side cache invalidation is needed (CSP is a response header, not cached by browsers across origins).

## Verification

After deploying, confirm the new entry appears in responses:

```bash
curl -sI https://your-app.onrender.com/ | grep -i content-security-policy
```

Compare the output with the origin you added. The command prints the header but
does not fail when an expected origin is missing. The [connect-src omission
drill](csp-connect-src-drill.md) records a rehearsal of this gap and a proposed
pre-deploy check.

## Notes

- The `hsts` option is only active when `NODE_ENV=production`. Ensure this is set in your production environment.
- The `preload` flag has been intentionally omitted until the domain is submitted to the HSTS preload list at https://hstspreload.org.
- `crossOriginResourcePolicy: cross-origin` is set so the dashboard can call the API across origins.
