# data/

This directory holds runtime state written by the CareGuard agent.

## ⚠️ DO NOT COMMIT these files

| File | Contents |
|------|----------|
| `spending.json` | Live per-day spending totals and policy state |
| `orders.json` | Full transaction history including amounts and wallet addresses |

Both files contain **sensitive financial data**. They must never appear in a commit or pull request.

Both paths are listed in `.gitignore`. If you see them untracked in `git status`, do not stage them.

CI will fail any PR where either file appears in the diff (see `.github/workflows/ci.yml`).
