# CareGuard Tech Stack

## Runtime

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 22 (minimum) | Node 24 also tested |
| TypeScript | **5.8.3** | Exact pin — see below |

### TypeScript Version Policy

We pin to an exact TypeScript version (no `^` caret) to avoid surprise breaking changes from minor releases.

**Chosen version: `5.8.3`**

Rationale:
- TypeScript 6 has not been released; `^6.0.x` in `package.json` resolved to a non-existent pre-release on some registries and caused fresh-clone failures (issue #113).
- `5.8.3` is the latest stable 5.x patch at the time this document was written.
- Both root `package.json` and `dashboard/package.json` pin to `5.8.3`.

To upgrade TypeScript in the future: bump the exact version in both `package.json` files, run `npm install --legacy-peer-deps`, commit the lock file, and verify `tsc --version` in CI.

## Backend

| Package | Purpose |
|---------|---------|
| Express 5 | HTTP server framework |
| tsx 4.x | TypeScript loader (dev + prod, see ADR 006) |
| ioredis | Redis client (optional — falls back to in-process cache when `REDIS_URL` is unset) |
| zod | Runtime schema validation |
| dotenv | Environment variable loading |

## Frontend (dashboard)

| Package | Version |
|---------|---------|
| Next.js | 16.x |
| React | 19.x |
| TypeScript | 5.8.3 |
| Tailwind CSS | 4.x |

## Payments

| Package | Purpose |
|---------|---------|
| @x402/express | x402 payment middleware (Stellar) |
| @stellar/mpp + mppx | Machine Payments Protocol |
| @stellar/stellar-sdk | Stellar blockchain SDK |

## Observability

| Tool | Purpose |
|------|---------|
| Prometheus | Metrics scraping (docker-compose.override.yml) |
| Grafana | Metrics dashboard (docker-compose.override.yml) |

## Testing

| Tool | Purpose |
|------|---------|
| vitest | Unit & integration test runner |
| supertest | HTTP assertion helper |
| ioredis-mock | Redis mock for unit tests |
| Playwright | End-to-end tests (dashboard) |
