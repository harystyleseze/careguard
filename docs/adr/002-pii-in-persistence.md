# ADR 002: Local Runtime Data Must Stay Out of Git

## Status

Accepted

## Context

CareGuard writes local runtime state under `data/` during development, including spending ledgers, order history, wallet addresses, transaction hashes, and policy state. Even on testnet, this data can reveal caregiver workflows and payment behavior. On mainnet, equivalent records would be sensitive financial and health-adjacent operational data.

The repository previously tracked `data/orders.json` and `data/spending.json`. Ignoring those paths after the fact is not enough while the files remain in the git index, because future edits continue to appear in pull requests.

## Decision

Runtime JSON files under `data/` are local working data and must not be committed.

- `data/*.json` and recipient-scoped JSON files are ignored by git.
- `data/.gitkeep` keeps the root data directory available in fresh clones.
- `data/orders.json` and `data/spending.json` are removed from the git index with `git rm --cached` while remaining available locally for developers who already have them.
- Pull requests must fail if runtime JSON files are added back to the diff.

## Migration Path

Issue #111 tracks the move from local file persistence to a managed database-backed model.

The migration should:

1. Introduce database tables for orders, spending transactions, recipient policy state, and audit events.
2. Provide a one-time import path for local `data/*.json` files used by development and demos.
3. Move production deployments to the database-backed store before any mainnet usage.
4. Apply database backups, access controls, retention limits, and audit logging appropriate for financial and care-related records.
5. Remove any dependency on checked-in runtime data fixtures after the database path is in place.

## Consequences

### Positive

- Prevents accidental disclosure of local order and spending history in PRs.
- Keeps clones usable by preserving the `data/` directory.
- Makes the persistence boundary explicit while the database migration is pending.

### Negative

- Developers must seed or generate local runtime files themselves.
- Existing local files no longer appear in git status once ignored.

### Neutral

- This does not remove sensitive data from repository history. If real secrets or production records were ever committed, the project would still need a history rewrite and credential rotation.
