# CareGuard — AI Healthcare Agent on Stellar

**An autonomous AI agent that manages elderly healthcare spending — comparing medication prices, auditing medical bills, and executing payments — all within caregiver-controlled spending policies on Stellar.**

Built for [Stellar Hacks: Agents](https://dorahacks.io/hackathon/stellar-agents-x402-stripe-mpp/detail) hackathon.

---

## The Problem

**63 million American caregivers** spend $7,200/year out of pocket managing their aging parents' healthcare. They face:

- **Medication price chaos**: Same drug costs 10x different at pharmacies 2 miles apart
- **Medical billing errors**: 80% of bills contain errors — average $1,300 on bills over $10K
- **Financial vulnerability**: 71% of caregivers are financially struggling

The tools available today are manual, disconnected, and don't close the payment loop.

## The Solution

CareGuard is an AI agent with a Stellar smart wallet that **autonomously**:

1. **Compares** medication prices across 5 pharmacies (paying per-query via x402)
2. **Audits** medical bills for duplicate charges, upcoding, and overcharges
3. **Checks** drug interactions before ordering
4. **Pays** for medications and bills via MPP Charge on Stellar (USDC)
5. **Enforces** spending policies set by the caregiver (Soroban smart contract design)

### Demo: Maria & Rosa

> Maria lives 800 miles from her 78-year-old mother Rosa. Rosa takes 4 medications from 3 pharmacies. Last month, Rosa's blood pressure medication cost $47 at CVS — but $12 at Costco. Nobody knew.
>
> Rosa's hospital sent a $4,200 bill with a $1,300 duplicate charge. Rosa would have paid it.
>
> **CareGuard found $69.76/month in medication savings and caught $1,195 in billing errors — for $0.03 in API costs.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 CAREGIVER DASHBOARD (Next.js)            │
│  Set policies │ View transactions │ Approve payments     │
├─────────────────────────────────────────────────────────┤
│              AI AGENT (Claude API tool-use)               │
│  Price comparison │ Bill auditing │ Payment decisions     │
├──────────────┬──────────────┬───────────────────────────┤
│  x402 Client │  MPP Client  │   Spending Policy Engine  │
│  (per-query  │  (medication │   (daily/monthly limits,  │
│   API calls) │   orders)    │    approval thresholds)   │
├──────────────┴──────────────┴───────────────────────────┤
│              STELLAR NETWORK (Testnet)                    │
│  USDC payments │ Soroban policies │ Transaction log      │
└─────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Technology | Stellar Integration |
|-----------|-----------|-------------------|
| **Pharmacy Price API** | Express.js + x402 middleware | x402 per-query payment ($0.002/query) |
| **Bill Audit API** | Express.js + x402 middleware | x402 per-audit payment ($0.01/audit) |
| **Drug Interaction API** | Express.js + x402 middleware | x402 per-check payment ($0.001/check) |
| **Pharmacy Payment** | Express.js + MPP Charge | MPP charge mode for medication orders |
| **AI Agent** | Claude API with tool-use | Autonomous decision-making with 7 tools |
| **Spending Policies** | Soroban smart contract design | Daily/monthly limits, category budgets, approval thresholds |
| **Dashboard** | Next.js + TypeScript + Tailwind | Real-time spending visualization |
| **Wallets** | Stellar testnet accounts | 6 funded wallets with USDC trustlines |

### How x402 and MPP Are Used

- **x402**: Agent pays per-query for healthcare data services (pharmacy prices, bill auditing, drug interactions). Each query costs $0.001-$0.01 in USDC. The x402 protocol returns a 402 Payment Required, the agent signs a Soroban auth entry, and the facilitator settles on Stellar.

- **MPP Charge**: Agent pays pharmacies for medication orders. Each order is a one-time USDC payment settled on Stellar via the MPP challenge-credential-receipt flow.

- **Soroban Spending Policies**: Caregiver sets spending limits that the agent cannot override:
  - Daily spending cap
  - Monthly medication budget
  - Monthly bill budget
  - Caregiver approval threshold (auto-pay below, flag above)

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/careguard
cd careguard
npm install --legacy-peer-deps

# Set up testnet wallets
npm run setup

# Fund agent wallet with testnet USDC at https://faucet.circle.com
# (select Stellar Testnet, paste your AGENT_PUBLIC_KEY)

# Start all services
npm run dev

# Start dashboard (separate terminal)
cd dashboard && npm run dev
```

### Services

| Service | Port | Protocol |
|---------|------|----------|
| Dashboard | 3000 | Next.js |
| Pharmacy Price API | 3001 | x402 |
| Bill Audit API | 3002 | x402 |
| Drug Interaction API | 3003 | x402 |
| Agent | 3004 | REST |
| Pharmacy Payment | 3005 | MPP Charge |

## Key Results

| Metric | Value |
|--------|-------|
| Medication savings found | **$69.76/month** ($837/year) |
| Billing errors caught | **$1,195** (47.8% of bill) |
| Agent API cost | **$0.03** |
| Tool calls per task | 13 (autonomous) |
| Policy enforcement | Blocks over-budget payments |

## Project Structure

```
careguard/
├── services/
│   ├── pharmacy-api/         # x402-protected price comparison
│   ├── bill-audit-api/       # x402-protected bill auditing
│   ├── drug-interaction-api/ # x402-protected interaction check
│   └── pharmacy-payment/     # MPP charge payment service
├── agent/                    # AI agent with Claude API
├── dashboard/                # Next.js caregiver dashboard
├── shared/                   # Shared TypeScript types
├── scripts/                  # Wallet setup
└── CLAUDE.md                 # Project context
```

## Why CareGuard Wins

1. **Application of Technology**: Uses x402 + MPP + Soroban policies — the three core Stellar payment primitives — each in their appropriate context
2. **Presentation**: Story-driven demo (Maria & Rosa) with visible micropayments and dramatic policy-block moment
3. **Business Value**: 63M caregivers, $7,200/yr OOP, $220B medical debt, $100-300B medication non-adherence
4. **Originality**: No other team builds for elderly caregivers with autonomous payment + spending controls

## Market Data

- 63 million American caregivers (50% increase since 2015)
- $7,200/year average out-of-pocket caregiver spending
- 80% of medical bills contain errors
- $220 billion in total US medical debt
- $100-300 billion/year in medication non-adherence costs
- Caregiver app market: $8.4B → $56.9B by 2032

---

*Built for Stellar Hacks: Agents 2026 | April 2026*
