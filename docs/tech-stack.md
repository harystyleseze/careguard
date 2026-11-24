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

## Dependency version pairing

Some dependencies must move together even though they are declared independently.
`scripts/check-vitest-version-lock.mjs` (wired into CI) enforces the first rule.

- **`vitest` ↔ `@vitest/coverage-v8` (issue #1395)** — `@vitest/coverage-v8` is
  published against the exact `vitest` version it instruments. Both are declared
  with identical `^` ranges and MUST be bumped together to the same release.
  `npm run check:vitest-lock` fails CI if the declared specifiers or the
  lockfile-resolved versions diverge.

- **`ioredis` ↔ `ioredis-mock` (issue #1385)** — ioredis-mock's major version is
  unrelated to ioredis's. This repo pairs `ioredis ^5` (dependencies) with
  `ioredis-mock ^8` (devDependencies); ioredis-mock 8.x declares `ioredis ^5` as
  a peer dependency and tracks the ioredis 5.x command surface. Commands used
  (`GET`, `SET` incl. `PX`/`NX`, `INCR`, `DEL`) are covered by the mock — see
  `shared/__tests__/redis-ioredis-mock.test.ts`. When bumping ioredis to a new
  major, move ioredis-mock to the 8.x line that tracks that major.

- **`proper-lockfile` (issue #1386)** — we intentionally stay on `^4.1.2`.
  `4.1.2` is the latest published release (Jun 2022) with no newer major; the
  package is a stable cooperative file-lock primitive with no known
  vulnerabilities. A Redis-based lock cannot replace it because the file locks
  (audit log, orders JSON, wallet migration) must work when `REDIS_URL` is unset.
  Do not migrate to a Redis lock without adding a filesystem fallback.

- **`pino` ↔ `pino-pretty` (issue #1394)** — pino-pretty's major version is
  independent of pino's. This repo pairs `pino ^10.3.1` (dependencies) with
  `pino-pretty ^13.1.3` (devDependencies). `13.1.3` is the current release that
  tracks the pino 10 formatting surface; both are at their latest release as of
  this writing. The pairing is commented near the logger setup in
  `shared/logger.ts`. When bumping pino to a new major, upgrade pino-pretty to
  the companion release and re-verify `npm run dev` pretty output.

- **`supertest` ↔ `@types/supertest` (issue #1392)** — the type package must not
  lag the runtime surface used by the HTTP integration tests. This repo pairs
  `supertest ^7.2.2` with `@types/supertest ^7.2.1`. Keep both on the latest
  published releases and re-run the vitest integration suites together when
  bumping.

- **`concurrently` (issue #1388)** — pinned to `^10.0.5` for the `npm run
  services` script. v10 dropped Node <22 (this repo requires >=22), is ESM-only
  (repo is `"type": "module"`), and made prefix colors automatic; the
  `--kill-others-on-fail` flag is unchanged and verified to still terminate
  sibling services when one exits non-zero.

- **`node-cron` (issue #1387)** — bumped to `^4.6.0`. `3.0.3` was the final 3.x
  release (no newer 3.x patch exists), but the library is actively maintained
  again on 4.x (zero dependencies, ships its own TypeScript types, so
  `@types/node-cron` was removed). `cron.schedule()` / `cron.validate()` are
  still exported unchanged, so no call-site or timezone changes were needed
  (timezone defaults to server-local time, same as before). **Alternative
  evaluated: `croner`** (latest 10.x) — actively maintained, zero-dep, ESM/CJS,
  richer API (`Cron` with `pause`/`resume`/timezone per job). Tradeoff: adopting
  it means rewriting the scheduler call site and adding wrappers for the
  `WALLET_BALANCE_CHECK_CRON` env expression and the graceful fallback to
  `setInterval`; it buys little for a single 15-minute wallet-balance job while
  node-cron 4.x already addresses the maintenance-cadence concern. Revisit only
  if we add more scheduled jobs that need per-job timezones or pause/resume.
