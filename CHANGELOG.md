# Changelog

All notable changes to CareGuard will be documented here.

This file is auto-updated by the release workflow on each `v*` tag push.

## [Unreleased]

### Changed
- **deps:** bump `dashboard/sonner` from `^2.0.3` to `^2.0.7` to align with root `sonner ^2.0.7` — eliminates duplicate toast render paths between server and dashboard. Verified `Toaster` props (`richColors`, `closeButton`, `position="top-right"` in `dashboard/src/components/ui/toaster.tsx:3`) and `toast.error()` usage in `dashboard/src/hooks/use-agent-state.ts:4,378` are unchanged between 2.0.3→2.0.7 (2.0.4 lift-interaction removal, 2.0.5 CSS fix, 2.0.6 pnpm/right-click fix, 2.0.7 `testId`/multi-toaster support — no breaking prop changes).
- **deps:** upgrade `@sentry/node` from `^8.45.1` to `^10.62.0` to align with `dashboard/@sentry/nextjs ^10.62.0` on the v10 line (OTEL v2). Migrated `shared/sentry.ts:58` `Sentry.init()` from deprecated `Sentry.Handlers.requestHandler/errorHandler` (removed in v8) to function-based `requestDataIntegration`/`httpIntegration`/`expressIntegration` with `Sentry.setupExpressErrorHandler(app)` fallback via `attachSentry` (`shared/sentry.ts:128`). Error capture and breadcrumbs verified via `beforeSend` redaction path; SDK versions now aligned: root `@sentry/node ^10.62.0` ↔ dashboard `@sentry/nextjs ^10.62.0` (which bundles `@sentry/node 10.62.0`).

### Documentation
- **contributing:** added `CHANGELOG.md` step to `CONTRIBUTING.md:Development Workflow` (user-facing changes require an entry; docs-only, internal refactor with no behavior change, and CI/config tweaks are exempt) and added PR template checkbox in `.github/PULL_REQUEST_TEMPLATE.md:12`.
- **contributing:** added `Troubleshooting` section to `CONTRIBUTING.md` covering Node version mismatch (`package.json:10` preinstall, `CONTRIBUTING.md:28`), Friendbot 429 rate-limit retry (`scripts/setup-wallets.ts:203,208,214`), and missing `OZ_FACILITATOR_API_KEY` 500/503 (`shared/x402-middleware.ts:120`, `server.ts:149`) with exact fix commands and `npm run check:env-vars` (`scripts/check-env-vars.ts:65`) as first-line diagnostic.
