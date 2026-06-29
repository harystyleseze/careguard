# ADR 002: PII-Sensitive Data in Local Persistence

**Status:** Accepted  
**Date:** 2026-06-29  
**Issues:** [#XXX](https://github.com/harystyleseze/careguard/issues/XXX)

---

## Context

CareGuard persists spending data, transaction logs, and policies to flat JSON/JSONL files under `data/`:

| File | Contents |
|------|----------|
| `data/recipients/{id}/spending.json` | Current spending tracker snapshot (USDC totals by category, transaction list, tx hashes) |
| `data/recipients/{id}/transactions.jsonl` | Append-only transaction log (medication names, provider names, amounts, timestamps, recipient addresses) |
| `data/recipients/{id}/orders.json` | Pharmacy order history (drug names, pharmacy names, dollar amounts, timestamps) |
| `data/recipients/{id}/policy.json` | Spending policy configuration (daily/monthly limits, category budgets, approval thresholds) |

Although the project currently runs on Stellar testnet, these files contain what is, in production, **protected health information (PHI)** under HIPAA and **personally identifiable information (PII)** under GDPR:

- **Medication lists** — a patient's full drug regimen (prescribed + OTC)
- **Spending patterns** — daily/monthly expenditure broken down by category
- **Pharmacy names** — revealed through transaction descriptions and order records
- **Stellar wallet addresses** — the agent's public key and recipient addresses linked to real individuals
- **Timestamps** — precise timestamps of every financial transaction and policy change

The `.gitignore` initially contained only `data/*`, which ignores files **directly** inside `data/` but does **not** ignore files nested in subdirectories such as `data/recipients/{id}/`. This left every `data/recipients/*.json` and `data/recipients/*.jsonl` file eligible for accidental `git add` and push.

### Risk scenario

1. Developer runs `git add data/` or `git add .` during development
2. `data/recipients/rosa/spending.json` (containing real testnet tx hashes, recipient addresses, spending amounts) is staged
3. Push to GitHub — the entire medication list, spending pattern, and wallet activity for "Rosa" is exposed publicly
4. On mainnet, this would leak actual patient data, violating HIPAA and GDPR

---

## Decision

**Keep filesystem persistence for now, but treat `data/` as an untracked local working directory only.**

Concrete measures:

1. **`.gitignore`** — use `data/**/*.json` and `data/**/*.jsonl` (recursive patterns covering all nesting levels), plus the existing `data/*` for root-level files
2. **`.gitkeep`** — commit `data/.gitkeep` so the directory exists on clone without tracking any data files
3. **Pre-commit hook** — CI workflow fails if any `.json` or `.jsonl` file under `data/` appears in a PR diff
4. **Removed from index** — `data/orders.json` and `data/spending.json` (if present) are `git rm --cached`'d and documented as local-only

### Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| **SQLite** (chosen for future) | Single file, ACID, no server process, easy backup | Requires migration; not yet implemented |
| **PostgreSQL** | Production-grade, access control, encryption at rest | Adds infrastructure dependency; overkill at current scale |
| **Encrypted JSON** | Keeps file format, adds AES-GCM envelope | Key management problem; complicates debugging |
| **Do nothing** | Zero effort | PII leak on first `git add .` |

---

## Consequences

### Positive

- PII/PHI cannot be accidentally committed — `.gitignore` blocks all patterns and CI double-checks
- `data/` is explicitly a working directory; new devs won't assume it should be committed
- Migration path to a DB is documented (#111)

### Negative

- CI cannot snapshot `data/` — integration tests that rely on persisted state must mock the filesystem or use a temp directory
- `data/recipients/` must be created at runtime if it doesn't exist (already handled by `getRecipientDir()` in `tools.ts`)

### Migration path (Issue #111)

1. Introduce an abstract `PersistenceBackend` interface with `load(key)`, `save(key, data)`, `append(key, line)` methods
2. Implement `JsonFileBackend` wrapping the current `readFileSync`/`writeFileSync` calls
3. Implement `SqliteBackend` using `better-sqlite3` with tables for `spending`, `transactions`, `orders`, `policy`
4. Add `PERSISTENCE_BACKEND=sqlite` env var — when set, agent uses SQLite instead of JSON files
5. Ship a one-shot migration script (`scripts/migrate-to-sqlite.ts`) that reads existing JSON/JSONL files and populates SQLite
6. Deprecate `JsonFileBackend` in a future major version

---

## File integrity after this ADR

```
data/
├── .gitkeep              # tracked — ensures dir exists on clone
├── README.md             # tracked — documentation
├── seed.json.example     # tracked — example seed data (no real PII)
└── recipients/
    └── rosa/
        ├── .gitkeep      # tracked — ensures subdir exists
        ├── orders.json   # UNTRACKED — blocked by data/**/*.json
        ├── spending.json # UNTRACKED — blocked by data/**/*.json
        ├── policy.json   # UNTRACKED — blocked by data/**/*.json
        └── transactions.jsonl  # UNTRACKED — blocked by data/**/*.jsonl
```
