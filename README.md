# CareGuard

**An autonomous AI agent that manages elderly healthcare spending on Stellar.**

Compares medication prices across pharmacies, audits medical bills for errors, checks drug interactions, and executes real USDC payments — all within caregiver-controlled spending policies. Every transaction settles on Stellar testnet via x402 and MPP.


---

## The Problem

**63 million American caregivers** spend $7,200/year out of pocket and 27 hours/week managing their aging parents' healthcare:

- Same medication costs **10x different** at pharmacies 2 miles apart
- **80% of medical bills** contain errors — average $1,300 overcharge on bills over $10K
- Only **0.1%** of denied insurance claims get appealed
- **71% of caregivers** are financially struggling

There is no tool that autonomously discovers the cheapest options, catches billing errors, and handles payments — with guardrails a caregiver can trust.

## How CareGuard Works

CareGuard is an AI agent with a Stellar wallet that acts on behalf of a family caregiver:

1. **Compares medication prices** across 5 pharmacies per drug — pays $0.002/query via x402 on Stellar
2. **Checks drug interactions** before ordering — pays $0.001/check via x402
3. **Orders medications** from the cheapest pharmacy — pays via MPP Charge on Stellar (real USDC)
4. **Audits medical bills** for duplicates, upcoding, overcharges — pays $0.01/audit via x402
5. **Pays corrected bill amounts** via direct Stellar USDC transfer
6. **Enforces spending policies** — daily/monthly limits, category budgets, caregiver approval thresholds

Every payment is a real Stellar testnet transaction verifiable on [stellar.expert](https://stellar.expert/explorer/testnet).

### USE CASE: Maria & Rosa

> Maria lives 800 miles from her 78-year-old mother Rosa. Rosa takes 4 medications from 3 pharmacies. Last month, Rosa's blood pressure medication cost $47 at CVS — $12 at Costco, 2 miles away. Nobody knew.
>
> Rosa's hospital sent a $2,500 bill with $1,195 in errors — duplicate charges and upcoded procedures. Rosa would have paid it.
>
> **CareGuard found $69.76/month in medication savings and caught $1,195 in billing errors — for $0.03 in agent API costs.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CAREGIVER DASHBOARD (Next.js)              │
│  Spending overview | Medications | Bills | Policy | Activity │
├─────────────────────────────────────────────────────────────┤
│                 AI AGENT (Groq LLM + tool-use)               │
│  Autonomous decision-making with 7 tools                     │
├──────────────────┬───────────────┬──────────────────────────┤
│   x402 Client    │  MPP Client   │   Spending Policy Engine │
│  Signs Soroban   │  Signs Soroban│   Daily/monthly limits   │
│  auth entries    │  SAC transfers│   Category budgets       │
│  per API query   │  per order    │   Approval thresholds    │
├──────────────────┴───────────────┴──────────────────────────┤
│                  STELLAR TESTNET (USDC)                       │
│  OZ Facilitator (x402) | MPP Charge | Direct transfers       │
│  All tx verifiable on stellar.expert                          │
└─────────────────────────────────────────────────────────────┘
```

### Payment Protocols Used

| Protocol | Purpose | How It Works |
|----------|---------|--------------|
| **x402** | Agent pays for API queries (pharmacy prices, bill audits, drug interactions) | Agent calls x402-protected endpoint → gets 402 → signs Soroban auth entry → OZ Facilitator settles on Stellar → agent receives data |
| **MPP Charge** | Agent pays pharmacies for medication orders | Agent orders medication → gets 402 challenge → signs Soroban SAC transfer → server broadcasts → order confirmed |
| **Stellar USDC Transfer** | Agent pays medical bills | Agent builds Stellar payment tx → signs with keypair → submits to Horizon → USDC transferred |

### Services

| Service | Port | Protocol | Price |
|---------|------|----------|-------|
| Pharmacy Price API | 3001 | x402 | $0.002/query |
| Bill Audit API | 3002 | x402 | $0.01/audit |
| Drug Interaction API | 3003 | x402 | $0.001/check |
| AI Agent | 3004 | REST | — |
| Pharmacy Payment | 3005 | MPP Charge | per-order |
| Dashboard | 3000 | Next.js | — |

---

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for the full setup guide.

```bash
# 1. Clone and install
git clone https://github.com/harystyleseze/careguard
cd careguard
npm install --legacy-peer-deps

# 2. Create testnet wallets
npm run setup

# 3. Configure .env (see .env.example)
cp .env.example .env
# Add: OZ_FACILITATOR_API_KEY, LLM_API_KEY, fund agent with testnet USDC

# 4. Start all services
npm run dev

# 5. Start dashboard (separate terminal)
cd dashboard && npm run dev

# 6. Open http://localhost:3000
```

---

## Tech Stack

| Component | Technology | Package |
|-----------|-----------|---------|
| AI Agent | Any OpenAI-compatible LLM (Groq, OpenRouter, OpenAI) | `openai` |
| x402 Server | Express + OZ Facilitator on Stellar | `@x402/express`, `@x402/stellar` |
| x402 Client | Auto 402-handling fetch wrapper | `@x402/fetch` |
| MPP Server | Express + Stellar charge mode | `@stellar/mpp`, `mppx` |
| MPP Client | Auto 402-handling fetch | `@stellar/mpp`, `mppx` |
| Bill Payments | Direct Stellar USDC transfers | `@stellar/stellar-sdk` v14 |
| Dashboard | Next.js + TypeScript + Tailwind | `next`, `react` |
| Persistence | JSON file storage | `fs` |

### Key Dependencies

- `@stellar/stellar-sdk` ^14.6.1 — Stellar network interaction
- `@x402/express` + `@x402/stellar` — x402 payment middleware (server-side)
- `@x402/fetch` — x402 payment client (auto 402 handling)
- `@stellar/mpp` + `mppx` — MPP charge mode (server + client)
- `openai` — OpenAI-compatible LLM client (Groq, OpenRouter, etc.)

---

## Verified Results

From real end-to-end test on Stellar testnet:

| Metric | Value |
|--------|-------|
| Medication savings found | **$69.76/month** ($837/year) |
| Billing errors caught | **$1,195** (47.8% of bill) |
| Agent x402 API cost | **$0.029** |
| Agent wallet USDC spent | **$7.53** (medications + bills + API fees) |
| Tool calls (autonomous) | **17** per full task |
| Stellar transactions | All verifiable on [stellar.expert](https://stellar.expert/explorer/testnet) |

---

## Project Structure

```
careguard/
├── agent/
│   ├── server.ts          # AI agent with LLM tool-use + REST API
│   └── tools.ts           # 7 tools: x402 client, MPP client, Stellar transfers, policy engine
├── services/
│   ├── pharmacy-api/      # x402-protected medication price comparison
│   ├── bill-audit-api/    # x402-protected medical bill auditing (CPT code analysis)
│   ├── drug-interaction-api/ # x402-protected drug interaction checking
│   └── pharmacy-payment/  # MPP Charge payment receiver for medication orders
├── dashboard/             # Next.js caregiver dashboard
│   └── src/app/page.tsx   # Overview, Medications, Bills, Policy, Activity tabs
├── shared/
│   └── types.ts           # Shared TypeScript types
├── scripts/
│   └── setup-wallets.ts   # Testnet wallet creation + USDC trustlines
├── data/                  # Persisted spending data + orders
├── .env.example           # Environment variable template
├── QUICKSTART.md          # Setup guide
```

---

## Why CareGuard

### Application of Technology
Uses x402 (per-query API payments) + MPP Charge (medication orders) + direct Stellar USDC transfers (bill payments) + spending policy engine — each payment protocol in its appropriate context.

### Business Value
63M caregivers, $7,200/yr out of pocket, $220B medical debt, 80% of bills have errors. CareGuard saves Rosa $2,320 in year one for $0.03 in API costs.

---

## Market Context

| Metric | Value | Source |
|--------|-------|--------|
| American caregivers | 63 million | AARP 2025 |
| Caregiver OOP spending | $7,200/year | AARP |
| Medical bills with errors | 80% | Orbdoc/Aptarro |
| US medical debt | $220 billion | Peterson-KFF |
| Medication non-adherence cost | $100-300B/year | CDC |
| Caregiver app market | $8.4B → $56.9B by 2032 | Wise Guy Reports |
| Hospital price transparency | Rules took effect April 1, 2026 | CMS |
