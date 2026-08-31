# Contributing to CareGuard

## Getting Started

```bash
git clone https://github.com/harystyleseze/careguard
cd careguard
npm install --legacy-peer-deps
cp .env.example .env
npm run setup   # generates testnet wallets
```

See [QUICKSTART.md](QUICKSTART.md) for full environment setup.

## Node.js Version Policy

This project requires **Node.js 22** and will refuse to install on earlier versions.

| Artifact | Pin |
|----------|-----|
| `.nvmrc` | `22` |
| `package.json` `engines` | `>=22.0.0` |
| CI matrix (`ci.yml`) | `[22]` (single version, no drift) |
| `render.yaml` `NODE_VERSION` | `22` |

If you use [nvm](https://github.com/nvm-sh/nvm), running `nvm use` in the project root will activate the correct version automatically.

**Why Node 22?** The server and agent entry-points use `--experimental-strip-types` and `--experimental-transform-types`, which reached stable shape in Node 22. Running on Node 20 will fail silently in some code paths and loudly in others.

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes with tests where applicable
3. Run `npm test` (root) and `cd dashboard && npm test` before pushing
4. Add an entry to `CHANGELOG.md` if your change is user-facing (new feature, bug fix, API change, or breaking change). Skip this for docs-only edits, internal refactors with no behavior change, and CI/config tweaks with no user-visible effect. Follow the existing Keep-a-Changelog style in `CHANGELOG.md:1`.
5. Open a pull request — CI must be green before merge

When cutting a release, update [`docs/release/compatibility-matrix.md`](docs/release/compatibility-matrix.md) with the new version row (Node, SDK, and API contract versions). See [docs/release/versioning.md](docs/release/versioning.md) for the full release process.

## Dependency Management

Dependencies are kept up to date automatically via [Dependabot](.github/dependabot.yml).

### What gets updated automatically

| Ecosystem | Directory | Schedule | Auto-merge |
|-----------|-----------|----------|------------|
| npm (root) | `/` | Weekly (Monday) | patch + minor |
| npm (dashboard) | `/dashboard` | Weekly (Monday) | patch + minor |
| GitHub Actions | `/.github/workflows` | Weekly (Monday) | patch + minor |
| Docker | `/` | Weekly (Monday) | patch + minor |

### Grouped updates

Related packages are batched into a single PR to reduce noise:

- `@stellar/*` — Stellar SDK and related packages
- `@x402/*` — x402 payment protocol packages
- `openai` — OpenAI SDK (solo PR, intentionally ungrouped)
- `next` + `react` + `react-dom` — Next.js core (dashboard)
- `tailwindcss` + `@tailwindcss/*` — Tailwind (dashboard)

### Workspace pin alignment (enforced)

To prevent silent drift between the root and `dashboard/` workspaces, the following
pins are intentionally aligned and checked in CI/lint:

| Package | Root | Dashboard | Strategy | Rationale |
|---------|------|-----------|----------|-----------|
| `@types/node` | `^25.6.0` | `^25.6.0` | **Exact caret major aligned** — both `^25.6.0` | `engines.node >=22` requires Node 22+ globals/APIs. Node 20 types (`^20`) omit `fetch`/`ReadableStream`/`URLPattern` refinements and other lib updates, causing incorrect type-checking for dashboard server code and API routes. Majors are intentionally aligned on `25` (latest compatible with `>=22`). Any Node 20-specific type workarounds must be removed; `tsc --noEmit` is run on both workspaces in CI. |
| `tailwindcss` | `^4.3.1` | `^4.3.1` | **Pinned minor `^4.3.1`** | `^4` allowed dashboard to resolve `4.2.x` while root used `4.3.1`, silently diverging utility-class behavior between builds. Pinning both to `^4.3.1` guarantees reproducible builds and identical utility output. Verify with `npm ls tailwindcss` and diff Tailwind build output before/after bumps. |
| `@tailwindcss/postcss` | `^4.3.1` | `^4.3.1` | **Pinned minor `^4.3.1`** | Same rationale as `tailwindcss` — the PostCSS plugin must match the Tailwind minor to avoid untested 4.x combinations. Lockfiles are regenerated so both workspaces resolve identical versions. |
| `react` / `react-dom` | `^19.2.5` | `^19.2.5` | **Caret `^19.2.5` on both** | Mixed strategies (root `^19.2.5` vs dashboard exact `19.2.5`) risk silent drift and duplicate React copies, which breaks hooks/context. The project standardizes on **caret** to allow Dependabot patch/minor auto-merges while keeping the range identical. Verify with `npm ls react` (and `npm ls react-dom`) — must show a single deduped version. Exact pinning was considered but rejected because it blocks automated security patches. |

**Preventing future drift:**
- `npm ls react`, `npm ls tailwindcss`, and `npm ls @tailwindcss/postcss` must show single resolved versions; add to CI if not present.
- Dependabot groups (`next`+`react`+`react-dom` and `tailwindcss`+`@tailwindcss/*`) are kept in sync — do not update one workspace without the other.
- A manual lint check: `node -p "require('./package.json').devDependencies.react === require('./dashboard/package.json').dependencies.react"` should be truthy for the shared packages above.

### Major version bumps

Major bumps are **not** auto-merged. Dependabot will open a PR labeled `major-update` + `needs-review`. A maintainer must:

1. Review the changelog / migration guide
2. Update any breaking API usage
3. Approve and merge manually

### Auto-merge behavior

The [dependabot-automerge workflow](.github/workflows/dependabot-automerge.yml) runs on every Dependabot PR:

- Waits for CI to pass
- Auto-squash-merges patch and minor updates
- Adds a comment and labels on major updates, blocking auto-merge

## Release Process

For information on versioning, deprecations, hotfixes, and rollbacks, see:

- [Versioning Guidelines](docs/release/versioning.md) — SemVer rules for breaking/minor/patch releases
- [Deprecation Policy](docs/release/deprecation-policy.md) — How to safely deprecate APIs and env vars
- [Hotfix Process](docs/release/hotfix-process.md) — Emergency patch release workflow
- [Rollback Procedure](docs/release/rollback.md) — How to revert a bad release

## Architecture Decisions

Significant architectural decisions are documented as ADRs in
[docs/adr/README.md](docs/adr/README.md). Before making a major
change, check whether a prior ADR covers the topic. If no existing
ADR addresses the decision, propose one using the template in the
ADR index.

## Security

- Never commit secrets or `.env` files — they are gitignored
- Stellar private keys must stay out of source control
- Report vulnerabilities privately via GitHub Security Advisories

## Code Style

- TypeScript strict mode — no `any` without justification (run `npm run typecheck` before pushing)
- Dashboard additionally runs ESLint (`cd dashboard && npm run lint`)
- Keep services self-contained; shared code goes in `shared/`

## API Changes

HTTP endpoints are described by [`docs/openapi.yml`](docs/openapi.yml), rendered
at `/docs` on the running server (<http://localhost:3000/docs> locally). The spec
is **generated** — never edit the YAML by hand:

1. Change the endpoint definition in [`scripts/gen-openapi.ts`](scripts/gen-openapi.ts)
2. Run `npm run gen-openapi` and commit the regenerated `docs/openapi.yml`
3. Run `npm run validate:openapi` — CI runs the same check plus a full OpenAPI
   3.1 lint, and fails on a malformed or out-of-date spec

See [`docs/api/README.md`](docs/api/README.md) for how the docs are hosted, how
CI validates the spec, and how the x402 `X-PAYMENT` auth scheme behaves.

## Observability

When adding or modifying metrics, follow the conventions in
[`docs/observability/metrics-naming.md`](docs/observability/metrics-naming.md).
This document covers naming conventions (prefixes, `_total` suffix, base-unit
policy), label-cardinality rules, and includes a checklist for new metrics.
Every new metric must also be added to
[`docs/observability/metrics-catalog.md`](docs/observability/metrics-catalog.md).

## Local Lock Troubleshooting

CareGuard uses `proper-lockfile` around local JSON state writes in `server.ts`,
`shared/audit-log.ts`, and `services/pharmacy-payment/server.ts`. Those locks
prevent concurrent requests from corrupting data under `data/`, but a killed
dev server can leave a stale `*.lock` directory behind.

If local requests hang or fail with lock-acquisition errors, inspect stale locks:

```bash
npm run clear:stale-locks
```

After confirming the listed paths belong to your local checkout, remove them:

```bash
npm run clear:stale-locks -- --yes
```

Use `--root=<path>` for a different data directory and
`--older-than-minutes=<n>` to adjust the stale-lock threshold.
## Troubleshooting

> **First step for any setup or runtime failure:** run `npm run check:env-vars` (which executes `scripts/check-env-vars.ts:65`) to validate that every key in `.env.example` is actually referenced in the codebase and to flag unused or missing vars. Its output (`⚠️  unused variables` / `✅ All environment variables ...`) often points directly at the missing `OZ_FACILITATOR_API_KEY` or `LLM_API_KEY`. See `scripts/check-env-vars.ts:14` for how it parses `.env.example`.

### 1. Node version mismatch — `Node.js 22 or later is required` or silent `--experimental-strip-types` failures

**Symptom (exact error text):**

- At install: `Node.js 22 or later is required (found v20.x.x).` from `package.json:10` `preinstall` script (`node -e "const v=parseInt(process.versions.node);if(v<22){process.stderr.write('Node.js 22 or later is required (found '+process.version+').\\n');process.exit(1);}"`).
- At runtime on Node 20: `SyntaxError`, `ReferenceError`, or silent no-ops where `agent/server.ts:11` / `server.ts` never start. The entry points use `node --import tsx` (`package.json:15` `agent`, `package.json:18` `services`, `server.ts:1` via `node --import tsx server.ts` per ADR `docs/adr/006-typescript-runtime.md:9`); Node 20 does not reliably support the loader-hook chain required by `tsx`, and the older flags `--experimental-strip-types` / `--experimental-transform-types` reached stable shape only in Node 22 (see `CONTRIBUTING.md:28` `Why Node 22?`).

**Fix — exact command / file to check:**

```bash
nvm install 22
nvm use 22                 # reads .nvmrc:22 if present; otherwise nvm use 22
node --version             # must print v22.x
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps   # root
cd dashboard && npm install && cd ..
npm run check:env-vars     # first-line diagnostic per scripts/check-env-vars.ts
```

**Files to check:** `.nvmrc:1` (`22`), `package.json:6` `engines >=22`, `render.yaml:10` `NODE_VERSION=22`, `docs/adr/006-typescript-runtime.md:9`.

### 2. Friendbot rate limits during `npm run setup`

**Symptom (exact error text):**

- `npm run setup` logs `transient Friendbot error, retrying` (`scripts/setup-wallets.ts:208`) with `Friendbot 429: ...` or `Friendbot 503: ...` (`scripts/setup-wallets.ts:203`), then after 5 attempts throws `Friendbot failed permanently for G...: ...` (`scripts/setup-wallets.ts:214`) or `Failed to fund G... after 5 attempts` (`scripts/setup-wallets.ts:237`).
- Followed by `Balance verification failed for G...: XLM balance is missing` (`scripts/setup-wallets.ts:177`) if Horizon has not yet indexed.
- The HTTP status comes from `https://friendbot.stellar.org?addr=G...` (`scripts/setup-wallets.ts:192`) returning `429 Too Many Requests` / `503` / `>=500`.

**Fix — exact command / file to check:**

The script retries automatically with exponential backoff `FRIENDBOT_RETRY_BASE_MS * 2^attempt` (`scripts/setup-wallets.ts:205` — 1000ms, 2000ms, 4000ms, 8000ms, 16000ms) for `MAX_FRIENDBOT_RETRIES=5` (`scripts/setup-wallets.ts:167`). If it still fails:

```bash
# Wait 60–120s (Friendbot is per-IP rate-limited), then resume — checkpoint skips funded wallets
npm run setup
# equivalent explicit:
npx tsx scripts/setup-wallets.ts
# inspect checkpoint (fundedWallets / trustedWallets lists)
cat .setup-wallets-checkpoint.json
# only if you want a full re-run, delete the checkpoint:
rm .setup-wallets-checkpoint.json && npm run setup
```

If `Balance verification failed` persists, wait 10s and re-run; Horizon (`https://horizon-testnet.stellar.org`) may lag. For Horizon connectivity issues the log shows `ECONNREFUSED` / `ENOTFOUND` / `ETIMEDOUT` (`scripts/setup-wallets.ts:221`).

**Files to check:** `scripts/setup-wallets.ts:167,192,203,208,214,237`, `.setup-wallets-checkpoint.json:1`, `QUICKSTART.md:39` (Friendbot funding step).

### 3. Missing `OZ_FACILITATOR_API_KEY` — x402 `402` / `500` failures

**Symptom (exact error text):**

- `GET /pharmacy/compare` or `POST /bill/audit` returns `500 {"error":"OZ_FACILITATOR_API_KEY missing — x402 payment middleware not configured"}` (`shared/x402-middleware.ts:120`).
- Server boot warns `OZ_FACILITATOR_API_KEY not set — x402 routes will fail until configured` (`server.ts:149`) or, when `STELLAR_NETWORK=public`, exits with `Missing/invalid env: OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public` (`server.ts:141`).
- `GET /ready` shows `"ozFacilitator":"not yet verified"` (`server.ts:310`) or health gate returns `503 {"error":"x402 facilitator unavailable; paid route temporarily disabled"}` (`shared/x402-middleware.ts:55`).
- `POST /pharmacy/order` never returns a `402 Payment Required` challenge with `X-PAYMENT` headers; the dashboard shows a generic 500 instead of a payment prompt (client `402` handling in `server.ts:887` / `services/pharmacy-payment/server.ts:181` is never reached).

**Fix — exact command / file to check:**

```bash
# 1. Generate a key (free)
open https://channels.openzeppelin.com/testnet/gen

# 2. Add to .env (see .env.example)
echo 'OZ_FACILITATOR_API_KEY=your_key_here' >> .env
echo 'X402_FACILITATOR_URL=https://channels.openzeppelin.com/x402/testnet' >> .env

# 3. Validate wiring (first-line diagnostic)
npm run check:env-vars
# if OZ_FACILITATOR_API_KEY is set but not used, the script will list it as used (searches process.env.OZ_FACILITATOR_API_KEY)

# 4. Restart and verify
npm run dev
curl -s http://localhost:3004/ready | jq .checks
# ozFacilitator should be true after the first successful x402 verify/settle
```

**Files to check:** `.env.example` (`OZ_FACILITATOR_API_KEY`), `shared/x402-middleware.ts:114,120`, `server.ts:141,148,279,310`, `docs/setup/x402.md:8`, `QUICKSTART.md:57`.

If the facilitator itself is down, check `x402FacilitatorState.lastError` logged as `x402 facilitator health check failed; paid routes will return 503` (`shared/x402-middleware.ts:167`) and retry after a few minutes.

## Smart Contract Guidelines (Stellar/Soroban)

If contributing to on-chain components:

- Use a **two-step ownership transfer** (`propose_admin` → `accept_admin`) to prevent accidental transfers to dead addresses
- Set the admin to a **Stellar multisig account** with appropriate `low_threshold`, `med_threshold`, and `high_threshold` — a single-key admin is a single point of failure
- Vesting rights transfers (`transfer_vesting_rights`) must require `recipient.require_auth()` — never admin auth — so only the recipient can rotate their own address
- Fee parameters must be stored in `DataKey::FeeConfig` in persistent storage and must be immutable within a transaction to prevent bait-and-switch scenarios
- Major contract changes require a security review before deployment
