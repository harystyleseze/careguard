# E2E Tests

Full-stack Playwright tests that boot the dashboard and drive it against a mocked agent server (Issue #51).

## What's tested

`tests/full-run.spec.ts` — Full agent run from the dashboard:

1. Open `/`
2. Click "Compare Medication Prices"
3. Assert the agent task completes within 30 s
4. Assert the Medications tab shows all 4 drugs with price data
5. Assert the Activity tab shows 4+ service-fee transactions and 4 medication orders

All agent API calls (`/agent/run`, `/agent/profile`, `/agent/spending`, etc.) are intercepted by Playwright route mocks — no real Stellar or LLM credentials needed.

## Running locally

```bash
# From careguard/e2e/
npx playwright install chromium   # first time only
npx playwright test

# Or from careguard/ root:
cd e2e && npx playwright test
```

The config starts the Next.js dashboard automatically on port 3000. If it's already running, it reuses the existing server.

## CI

Set `PLAYWRIGHT_SKIP_WEBSERVER=true` and start the dashboard separately before running tests:

```bash
# In CI workflow:
cd dashboard && npm run build && npm run start &
cd e2e && PLAYWRIGHT_SKIP_WEBSERVER=true npx playwright test
```

Screenshots and traces are uploaded on failure (configured in `playwright.config.ts`).

## Config

| Option | Value |
|---|---|
| Base URL | `http://localhost:3000` (override with `PLAYWRIGHT_BASE_URL`) |
| Workers | 1 (single worker to avoid port conflicts) |
| Timeout | 30 s per test |
| Browser | Chromium (headless) |
| Retries in CI | 1 |

## Adding tests

Add new `.spec.ts` files under `e2e/tests/`. Use the `mockAgentApis` helper in `full-run.spec.ts` as a reference for intercepting agent API calls.
