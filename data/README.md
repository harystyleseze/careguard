# data/

This directory holds runtime state written by the CareGuard agent.

## ⚠️ DO NOT COMMIT these files

| File | Contents |
|------|----------|
| `spending.json` | Live per-day spending totals and policy state |
| `orders.json` | Full transaction history including amounts and wallet addresses |
| `adherence.jsonl` | Medication adherence tracking entries |
| `recipients/*/spending.json` | Per-recipient spending data (replaces root spending.json) |
| `recipients/*/orders.json` | Per-recipient order history |
| `recipients/*/policy.json` | Per-recipient spending policy |

These files contain **sensitive financial data**. They must never appear in a commit or pull request.

All paths are listed in `.gitignore`. If you see them untracked in `git status`, do not stage them.

CI will fail any PR where these files appear in the diff (see `.github/workflows/ci.yml`).
