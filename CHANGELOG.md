# Changelog

All notable changes to CareGuard will be documented here.

This file is auto-updated by the release workflow on each `v*` tag push.

## [Unreleased]

### Added
- **dashboard/agent:** #1237 Basic vitals tracking (weight, blood pressure, glucose). New `vitals` table and `/agent/vitals` routes (`services/vitals/`), `GET /agent/adherence/timeline`, a Medications-tab entry form with a trend chart showing adherence markers, and logged vitals included in the medication PDF export.
- **dashboard/agent:** #1238 Spending-policy changes now show an old-vs-new preview with the impact on recent payments before saving. `check_spending_policy` logic is shared through `evaluateSpendingPolicy`/`simulatePolicyImpact` in `agent/tools.ts`, exposed as `POST /agent/policy/preview`.

### Fixed
- **bill-audit:** #1046 unified mode now loads the standalone duplicate allowlist and per-CPT thresholds, including SIGHUP reloads; stale-rate status is included in the audit response and recommendation.
- **agent:** #1047 removed the duplicate `fs` import from `agent/server.ts`.
- **drug-interaction-api:** #1044 title-cases every word and hyphen-delimited part of medication names.
- **dashboard:** #1239 Overview stat cards use a muted, dashed style with "Run a task to see…" prompts before any task has run, instead of a bare $0.00; a genuine zero after a run keeps the normal style.
- **dashboard:** #1240 Bills empty state now explains the benefit (catching billing errors), adds an icon, and links to the audit action.
- **dashboard/agent:** fixed parse errors on main in `medications-tab.tsx` (missing brace) and `agent/server.ts` (duplicated `runAgent` options block from a merge).
- **dashboard:** #1276 Settings tab now warns before discarding unsaved edits. Added confirmation dialog and beforeunload handler when caregiver navigates away mid-edit, plus prominent warning banner during edit mode.
- **dashboard:** #1270 Policy limit fields now show real-world helper text. Added context-specific guidance below Daily Spending Limit, Monthly Spending Limit, Medication/Bill Budget, and Approval Threshold to help caregivers set sensible values.
- **dashboard:** #1267 Agent Response card now renders with better structure. Detects and formats numbered lists, adds 'Show more' truncation for long responses (>500 chars), keeping raw text accessible if parsing fails.
- **dashboard:** #1246 Agent log error entries now visually stand out. Added red styling, warning icon, and "Error:" label prefix to entries with errorDetail, making failures immediately scannable in the collapsed log view.

### Changed
- **deps:** bump `dashboard/sonner` from `^2.0.3` to `^2.0.7` to align with root `sonner ^2.0.7` — eliminates duplicate toast render paths between server and dashboard. Verified `Toaster` props (`richColors`, `closeButton`, `position="top-right"` in `dashboard/src/components/ui/toaster.tsx:3`) and `toast.error()` usage in `dashboard/src/hooks/use-agent-state.ts:4,378` are unchanged between 2.0.3→2.0.7 (2.0.4 lift-interaction removal, 2.0.5 CSS fix, 2.0.6 pnpm/right-click fix, 2.0.7 `testId`/multi-toaster support — no breaking prop changes).
- **deps:** upgrade `@sentry/node` from `^8.45.1` to `^10.62.0` to align with `dashboard/@sentry/nextjs ^10.62.0` on the v10 line (OTEL v2). Migrated `shared/sentry.ts:58` `Sentry.init()` from deprecated `Sentry.Handlers.requestHandler/errorHandler` (removed in v8) to function-based `requestDataIntegration`/`httpIntegration`/`expressIntegration` with `Sentry.setupExpressErrorHandler(app)` fallback via `attachSentry` (`shared/sentry.ts:128`). Error capture and breadcrumbs verified via `beforeSend` redaction path; SDK versions now aligned: root `@sentry/node ^10.62.0` ↔ dashboard `@sentry/nextjs ^10.62.0` (which bundles `@sentry/node 10.62.0`).

### Documentation
- **contributing:** added `CHANGELOG.md` step to `CONTRIBUTING.md:Development Workflow` (user-facing changes require an entry; docs-only, internal refactor with no behavior change, and CI/config tweaks are exempt) and added PR template checkbox in `.github/PULL_REQUEST_TEMPLATE.md:12`.
- **contributing:** added `Troubleshooting` section to `CONTRIBUTING.md` covering Node version mismatch (`package.json:10` preinstall, `CONTRIBUTING.md:28`), Friendbot 429 rate-limit retry (`scripts/setup-wallets.ts:203,208,214`), and missing `OZ_FACILITATOR_API_KEY` 500/503 (`shared/x402-middleware.ts:120`, `server.ts:149`) with exact fix commands and `npm run check:env-vars` (`scripts/check-env-vars.ts:65`) as first-line diagnostic.
