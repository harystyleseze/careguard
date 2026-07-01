# Data Storage Convention

## Overview

Runtime state written by the CareGuard agent is stored under `data/`. This directory is excluded from version control via `.gitignore`. Never commit files under `data/` to git.

## Directory Layout

```
data/
├── README.md                  # Brief usage note
├── seed.json.example          # Bootstrap template for new deployments
├── recipients/
│   └── <recipientId>/
│       ├── spending.json           # Legacy full-file (backward compat)
│       ├── transactions.jsonl      # Append-only log (one JSON line per tx)
│       ├── spending.snapshot.json  # Compacted snapshot (every 100 txs)
│       ├── policy.json             # Per-recipient spending policy
│       └── orders.json             # Order history
```

## Persistence Strategy

- **transactions.jsonl**: Append-only. Each transaction is written as a single JSON line (O(1) per call).
- **spending.snapshot.json**: Compacted full state written every 100 transactions via atomic rename.
- **spending.json**: Legacy full-file written on every save for backward compatibility with external tooling.

On startup, the agent reads the snapshot, then replays only the JSONL lines appended after the last compaction.

## Bootstrap

Copy `data/seed.json.example` to the per-recipient directory to initialize spending state:

```bash
cp data/seed.json.example data/recipients/rosa/spending.json
```

## Sensitive Data

The following files contain sensitive financial data and must never appear in git history:

| File | Contents |
|------|----------|
| `spending.json` | Live per-day spending totals and policy state |
| `orders.json` | Full transaction history including amounts and wallet addresses |
| `transactions.jsonl` | Append-only transaction log |
| `policy.json` | Spending policy configuration |

## Git History Scrubbing

If sensitive data files were committed in the past, use `git filter-repo` to remove them from history:

```bash
git filter-repo --path data/spending.json --path data/orders.json --invert-paths
```

After scrubbing, force-push to all branches and notify collaborators to rebase.
