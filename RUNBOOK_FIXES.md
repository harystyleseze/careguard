# Fixes: #971, #972, #973, #974

## #974 — Runbook index drift detection
Created `scripts/check-runbook-index.ts` that:
- Parses the Index table in `docs/runbooks/README.md` and verifies every linked file exists
- Flags files in `docs/runbooks/` that are not listed in the Index (catches additions)
- Exits non-zero on mismatch, suitable for CI

## #973 — Docs freshness check
The same script checks `Last verified:` headers across runbooks:
- Flags any runbook without a header
- Flags runbooks with headers older than the configurable threshold (default: 180 days)
- Run with `--max-age-days=N` to adjust

## #972 — Last-verified convention
Convention: `<!-- Last verified: YYYY-MM-DD -->` in the first 5 lines of each runbook.
This script enforces the convention. The existing ad-hoc example in
`webhook-secret-rotation.md` should be reconciled to this format.

## #971 — x402 facilitator game-day drill
Documented in `docs/runbooks/x402-facilitator-down.md` — two drills:
- **Drill A**: facilitator unreachable at boot → critical log + exit code 1
- **Drill B**: facilitator goes down post-boot → paid routes return 503, unpaid stay healthy, auto-recovery via health checks
Findings should be linked from the runbook after rehearsal.
