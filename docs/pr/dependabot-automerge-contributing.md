# PR: Dependabot Automation, Dockerfile & CONTRIBUTING.md

**Branch:** `main`
**Commit:** `7238874`
**Repo:** https://github.com/Johnsmichael150/careguard

---

## Summary

Adds automated dependency management, a minimal Dockerfile, and contributor documentation to the CareGuard project.

---

## Changes

### `.github/dependabot.yml`
Configures Dependabot to watch four ecosystems on a weekly Monday schedule:

| Ecosystem | Directory | Schedule |
|-----------|-----------|----------|
| npm (root) | `/` | Weekly — Monday |
| npm (dashboard) | `/dashboard` | Weekly — Monday |
| GitHub Actions | `/.github/workflows` | Weekly — Monday |
| Docker | `/` | Weekly — Monday |

Related packages are grouped to reduce PR noise:
- `@stellar/*` — Stellar SDK and related packages
- `@x402/*` — x402 payment protocol packages
- `openai` — solo PR (intentionally ungrouped)
- `next` + `react` + `react-dom` — Next.js core (dashboard)
- `tailwindcss` + `@tailwindcss/*` — Tailwind (dashboard)

---

### `.github/workflows/dependabot-automerge.yml`
GitHub Actions workflow that runs on every Dependabot PR:

- Fetches Dependabot metadata to determine update type
- Waits for CI checks to pass
- Auto-squash-merges `semver-patch` and `semver-minor` updates
- Labels `semver-major` PRs with `major-update` + `needs-review` and posts a blocking comment requiring human review

---

### `Dockerfile`
Minimal Node 22 Alpine image for the unified production server:

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
EXPOSE 3004
CMD ["node", "--experimental-strip-types", "--experimental-transform-types", "--no-warnings", "server.ts"]
```

Required so the `docker` Dependabot ecosystem has a file to track.

---

### `CONTRIBUTING.md`
Documents:
- Local dev setup
- Branch and PR workflow
- Dependency update strategy (Dependabot groups, auto-merge rules, major bump process)
- Security guidelines (no secrets in source, Stellar key handling)
- Smart contract security guidelines:
  - Two-step ownership transfer (`propose_admin` → `accept_admin`)
  - Multisig admin recommendation
  - Recipient-only vesting rotation (`transfer_vesting_rights` requires `recipient.require_auth()`)
  - Immutable fee config via `DataKey::FeeConfig`

---

## Acceptance Criteria

- [x] `dependabot.yml` covers `/` npm, `/dashboard` npm, `.github/workflows`, and `Dockerfile` — all weekly
- [x] `@stellar/*`, `@x402/*`, and `openai` are grouped (or solo) at root
- [x] `dependabot-automerge.yml` auto-merges patch + minor when CI is green
- [x] Major bumps are labeled and blocked from auto-merge, requiring human review
- [x] `CONTRIBUTING.md` documents the full dep update strategy and smart contract security guidelines

---

## Testing

No runtime code was changed. To verify:

```bash
# Confirm workflow syntax is valid
gh workflow list

# Simulate a Dependabot PR by checking the automerge logic manually
cat .github/workflows/dependabot-automerge.yml
```
