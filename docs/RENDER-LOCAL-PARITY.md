# Render ↔ Local Environment Parity

When debugging a production-only issue, the fastest path is reproducing the
exact environment that Render runs. This guide maps every setting in
`render.yaml` to its local `.env` equivalent and flags the places where local
and production are intentionally different.

---

## Runtime / build

| render.yaml setting | Local equivalent | Notes |
|---|---|---|
| `runtime: node` | your shell's `node` binary | |
| `NODE_VERSION: "22"` | `.nvmrc` → `22`; `package.json` `engines >=22` | Run `nvm use` to activate. See [Node.js Version Policy](../CONTRIBUTING.md#nodejs-version-policy). |
| `buildCommand: npm ci && npm run build` | `npm install --legacy-peer-deps` (dev) | Render uses `npm ci` + compiles to `dist/`. Locally you run source via `tsx`. |
| `startCommand: node dist/server.js` | `npm run dev` → `node --import tsx server.ts` | **Intentionally different.** Prod runs compiled JS; local runs TypeScript directly through `tsx`. To test the compiled output locally: `npm run build && node dist/server.js`. |
| `healthCheckPath: /health` | `GET http://localhost:3004/health` | Same endpoint, same logic. |
| `plan: free` | n/a | Render free tier sleeps after inactivity; not reproducible locally. |

---

## Stellar

| render.yaml key | `.env.example` key | Local value | Prod value | Intentionally different? |
|---|---|---|---|---|
| `STELLAR_NETWORK` | `STELLAR_NETWORK` | `testnet` | `testnet` | No — both use testnet. Change to `mainnet` only when going to production. |
| `STELLAR_RPC_URL` | `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` | `https://soroban-testnet.stellar.org` | No |
| `USDC_ISSUER` | `USDC_ISSUER` | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | same | No |
| `USDC_SAC` | not in `.env.example` | set in render.yaml only | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | Add to `.env` to mirror prod. |

---

## Wallet keys (secrets)

All wallet keys use `sync: false` in `render.yaml`, meaning they are set
manually in the Render dashboard and never stored in version control.

| render.yaml key | `.env.example` key | How to get a local value |
|---|---|---|
| `AGENT_SECRET_KEY` | `AGENT_SECRET_KEY` | `npm run setup` |
| `AGENT_PUBLIC_KEY` | `AGENT_PUBLIC_KEY` | `npm run setup` |
| `CAREGIVER_SECRET_KEY` | `CAREGIVER_SECRET_KEY` | `npm run setup` |
| `CAREGIVER_PUBLIC_KEY` | `CAREGIVER_PUBLIC_KEY` | `npm run setup` |
| `PHARMACY_1_SECRET_KEY` | `PHARMACY_1_SECRET_KEY` | `npm run setup` |
| `PHARMACY_1_PUBLIC_KEY` | `PHARMACY_1_PUBLIC_KEY` | `npm run setup` |
| `PHARMACY_2_SECRET_KEY` | `PHARMACY_2_SECRET_KEY` | `npm run setup` |
| `PHARMACY_2_PUBLIC_KEY` | `PHARMACY_2_PUBLIC_KEY` | `npm run setup` |
| `PHARMACY_3_SECRET_KEY` | `PHARMACY_3_SECRET_KEY` | `npm run setup` |
| `PHARMACY_3_PUBLIC_KEY` | `PHARMACY_3_PUBLIC_KEY` | `npm run setup` |
| `BILL_PROVIDER_SECRET_KEY` | `BILL_PROVIDER_SECRET_KEY` | `npm run setup` |
| `BILL_PROVIDER_PUBLIC_KEY` | `BILL_PROVIDER_PUBLIC_KEY` | `npm run setup` |
| `MPP_SECRET_KEY` | `MPP_SECRET_KEY` | `openssl rand -hex 32` |

> These are **testnet** keypairs only. Never use mainnet keys locally.

---

## x402 / payments

| render.yaml key | `.env.example` key | Notes |
|---|---|---|
| `OZ_FACILITATOR_API_KEY` | `OZ_FACILITATOR_API_KEY` | `sync: false` — get a free key at https://channels.openzeppelin.com/testnet/gen |
| `X402_FACILITATOR_URL` | `X402_FACILITATOR_URL` | Both use `https://channels.openzeppelin.com/x402/testnet` |

---

## LLM

| render.yaml key | `.env.example` key | Prod value | Notes |
|---|---|---|---|
| `LLM_API_KEY` | `LLM_API_KEY` | `sync: false` | Same provider (Groq) in both environments by default. |
| `LLM_BASE_URL` | `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | Match this locally to reproduce prod LLM behaviour. |
| `LLM_MODEL` | `LLM_MODEL` | `llama-3.3-70b-versatile` | Match this locally. Using a different model locally is a common cause of prod-only agent failures. |

---

## Server / network

| render.yaml key | `.env.example` key | Local value | Prod value | Intentionally different? |
|---|---|---|---|---|
| `PORT` | `PORT` | `3004` | `3004` | No |
| `NODE_ENV` | not in `.env.example` | unset (defaults to `development`) | `production` | **Yes — intentionally different.** Set `NODE_ENV=production` locally to reproduce prod-only code paths (e.g. Sentry activation, stricter CORS, dist build). |
| `ALLOWED_ORIGINS` | `ALLOWED_ORIGINS` | `http://localhost:3000` | dashboard URL(s), `sync: false` | **Yes — intentionally different.** Prod uses the deployed dashboard origin. Set to your local dashboard URL when running locally. |
| `REDIS_URL` | `REDIS_URL` | unset (in-process Map) | set via `sync: false` | **Yes — intentionally different.** Prod uses Redis for shared state across instances. To reproduce: `docker compose up redis` and set `REDIS_URL=redis://localhost:6379`. |
| `MAX_SINGLE_TX_USDC` | `MAX_SINGLE_TX_USDC` | `100` | `100` | No |

---

## Service URLs

In `render.yaml` the service URLs all point to `localhost:3004`, which matches
the unified-server pattern where all sub-services run on the same port.

| render.yaml key | `.env.example` key | Value |
|---|---|---|
| `PHARMACY_API_URL` | `PHARMACY_API_URL` | `http://localhost:3004` |
| `BILL_AUDIT_API_URL` | `BILL_AUDIT_API_URL` | `http://localhost:3004` |
| `DRUG_INTERACTION_API_URL` | `DRUG_INTERACTION_API_URL` | `http://localhost:3004` |
| `PHARMACY_PAYMENT_URL` | `PHARMACY_PAYMENT_API_URL` | `http://localhost:3004` (note: key name differs by one suffix — `_API_URL` locally) |

---

## Settings present locally but absent from render.yaml

These variables exist in `.env.example` but are not set in `render.yaml`.
If a bug only reproduces with a non-default value, check whether prod has
them set outside the YAML (directly in the Render dashboard).

| `.env.example` key | Default | Why absent from render.yaml |
|---|---|---|
| `SPENDING_TIMEZONE` | `America/Phoenix` | Not set in render.yaml; prod uses the default. |
| `MOCK_NETWORK` | `0` | Dev/test only. Must be `0` (or unset) in prod. |
| `MAX_TOOL_CALLS_PER_RUN` | `30` | Uses default; only needed to tune in prod. |
| `MAX_AGENT_ITERATIONS` | `15` | Uses default. |
| `SENTRY_DSN` | empty | Set in Render dashboard when Sentry is enabled. |
| `CAREGIVER_TOKEN` | — | Set in Render dashboard as a secret. |
| `WALLET_BALANCE_CHECK_ENABLED` | `0` | Scheduler disabled by default; enabled in prod via Render env. |
| `LLM_PII_SCRUB` | `true` | Must remain `true` in prod; only change with a signed BAA. |
| `MULTI_PHARMACY_MODE` | `false` | Feature flag; set in Render dashboard if enabled. |
| `DASHBOARD_ORIGIN` | unset | Alternative to `ALLOWED_ORIGINS`; set one or the other. |

---

## Quickstart: reproducing a prod-only bug locally

Minimal `.env` additions to bring local closer to Render:

```bash
# Match prod Node.js and build output
nvm use 22
npm run build
NODE_ENV=production node dist/server.js

# Match prod LLM
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile

# Match prod Redis (requires Docker)
docker compose up redis -d
REDIS_URL=redis://localhost:6379

# Add USDC_SAC (present in render.yaml, absent from .env.example)
USDC_SAC=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

For secret rotation procedures on the live Render deployment, see
[docs/runbooks/rotate-render-secrets.md](runbooks/rotate-render-secrets.md).
