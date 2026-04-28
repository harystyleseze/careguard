# CareGuard Dashboard

CareGuard's dashboard is the caregiver control plane for the AI agent. It lets you run autonomous tasks, inspect spending, adjust policy guardrails, and export human-readable PDF reports.

## This Is NOT the Next.js You Know

This project uses Next.js 16. Before contributing, read the Next.js docs shipped in `node_modules/next/dist/docs/` and follow breaking-change guidance.

## Prerequisites

- Node.js 22+
- pnpm
- CareGuard backend running (`npm run dev` from the repo root)

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3004
```

3. Start the dashboard:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000).

## Tab to Endpoint Map (7 Tabs)

| Tab | What it does | Primary endpoints |
| --- | --- | --- |
| `overview` | Run agent workflows and track totals | `POST /agent/run`, `GET /agent/spending` |
| `medications` | View medication compare/interaction results | Reads from `POST /agent/run` result payload (tool outputs) |
| `bills` | View bill audit results and download bill PDF | Reads from `POST /agent/run` result payload, exports via `src/app/pdf.ts` |
| `policy` | Update spending limits and approval threshold | `POST /agent/policy`, `GET /agent/spending` |
| `wallet` | Show agent wallet and balances | `GET /`, `GET https://horizon-testnet.stellar.org/accounts/:wallet` |
| `activity` | Browse transaction log, reset state, download report | `GET /agent/transactions`, `POST /agent/reset`, exports via `src/app/pdf.ts` |
| `settings` | Pause/resume autonomous actions | `POST /agent/pause`, `POST /agent/resume` |

Note: background refresh uses `GET /`, `GET /agent/spending`, and `GET /agent/transactions`.

## PDF Reports

Generated client-side from `dashboard/src/app/pdf.ts`.

- `careguard-medication-report.pdf`
  - Sample output: monthly medication savings summary, per-pharmacy price tables, drug interaction section.
- `careguard-bill-audit-report.pdf`
  - Sample output: total charged vs corrected amount, overcharge totals, line-item status table.
- `careguard-transaction-report.pdf`
  - Sample output: medications/bills/service-fees summary and transaction ledger with Stellar Tx references.

## Deployment

- Production deployment runbook: [docs/deploy.md](../docs/deploy.md)
- One-click dashboard deploy:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/harystyleseze/careguard&project-name=careguard-dashboard&root-directory=dashboard)

## Related Docs

- Root quick start: [../QUICKSTART.md](../QUICKSTART.md)
- Architecture details: [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
