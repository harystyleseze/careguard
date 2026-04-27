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

## Development Workflow

1. Fork the repo and create a branch from `main`
2. Make your changes with tests where applicable
3. Run `npm test` (root) and `cd dashboard && npm test` before pushing
4. Open a pull request — CI must be green before merge

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

## Security

- Never commit secrets or `.env` files — they are gitignored
- Stellar private keys must stay out of source control
- Report vulnerabilities privately via GitHub Security Advisories

## Code Style

- TypeScript strict mode — no `any` without justification
- ESLint + Prettier (run `npm run lint` before pushing)
- Keep services self-contained; shared code goes in `shared/`

## Smart Contract Guidelines (Stellar/Soroban)

If contributing to on-chain components:

- Use a **two-step ownership transfer** (`propose_admin` → `accept_admin`) to prevent accidental transfers to dead addresses
- Set the admin to a **Stellar multisig account** with appropriate `low_threshold`, `med_threshold`, and `high_threshold` — a single-key admin is a single point of failure
- Vesting rights transfers (`transfer_vesting_rights`) must require `recipient.require_auth()` — never admin auth — so only the recipient can rotate their own address
- Fee parameters must be stored in `DataKey::FeeConfig` in persistent storage and must be immutable within a transaction to prevent bait-and-switch scenarios
- Major contract changes require a security review before deployment
