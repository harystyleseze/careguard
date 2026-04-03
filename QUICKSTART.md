# CareGuard Quick Start Guide

Get CareGuard running on Stellar testnet with real x402 and MPP payments.

---

## Prerequisites

- **Node.js** 20 or later
- **npm** (comes with Node.js)
- **A Groq API key** (free) — [console.groq.com](https://console.groq.com)
- **An OZ Facilitator API key** (free) — [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen)

---

## Step 1: Install Dependencies

```bash
git clone https://github.com/YOUR_USERNAME/careguard
cd careguard
npm install --legacy-peer-deps
```

For the dashboard:
```bash
cd dashboard
npm install
cd ..
```

---

## Step 2: Create Testnet Wallets

```bash
npm run setup
```

This creates 6 Stellar testnet wallets (agent, caregiver, 3 pharmacies, bill provider), funds them with XLM via Friendbot, and adds USDC trustlines.

Copy the outputted keys into your `.env` file.

---

## Step 3: Configure Environment

```bash
cp .env.example .env
```

Fill in these required values:

| Variable | Where to get it |
|----------|----------------|
| `AGENT_SECRET_KEY` / `AGENT_PUBLIC_KEY` | From `npm run setup` output |
| All `PHARMACY_*` and `BILL_PROVIDER_*` keys | From `npm run setup` output |
| `OZ_FACILITATOR_API_KEY` | [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen) |
| `MPP_SECRET_KEY` | Run: `openssl rand -hex 32` |
| `LLM_API_KEY` | [console.groq.com](https://console.groq.com) (or any OpenAI-compatible provider) |

---

## Step 4: Fund Agent with Testnet USDC

The agent wallet needs USDC to make payments.

1. Go to [faucet.circle.com](https://faucet.circle.com)
2. Select **Stellar Testnet**
3. Paste your `AGENT_PUBLIC_KEY` (starts with G...)
4. Click request — you'll receive testnet USDC

You can request multiple times if you need more for testing.

---

## Step 5: Start Services

Terminal 1 — Backend services + agent:
```bash
npm run dev
```

This starts:
- Pharmacy Price API (port 3001) — x402 protected
- Bill Audit API (port 3002) — x402 protected
- Drug Interaction API (port 3003) — x402 protected
- Pharmacy Payment Service (port 3005) — MPP Charge
- AI Agent (port 3004) — Groq LLM with tool-use

Terminal 2 — Dashboard:
```bash
cd dashboard
npm run dev
```

Dashboard runs on [http://localhost:3000](http://localhost:3000).

---

## Step 6: Use the Dashboard

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Overview Tab
- See spending summary, budget bars, and agent actions
- Click **"Compare Medication Prices"** — agent queries 5 pharmacies for 4 medications, checks drug interactions, and orders from the cheapest
- Click **"Audit Hospital Bill"** — agent scans a bill for errors and identifies overcharges
- Click **"Try Over-Budget Payment"** — agent attempts a payment that exceeds the spending policy and gets blocked

### Medications Tab
- See price comparison results for each medication
- Drug interaction alerts with severity levels

### Bills Tab
- Line-by-line bill audit results
- Errors highlighted: duplicates, upcoding, overcharges
- Original vs corrected amounts

### Policy Tab
- Set daily/monthly spending limits
- Set medication and bill category budgets
- Set the caregiver approval threshold

### Activity Tab
- Terminal-style agent log showing every tool call
- Transaction table with clickable Stellar Explorer links
- Every completed transaction links to [stellar.expert](https://stellar.expert/explorer/testnet)

---

## Switching LLM Providers

CareGuard works with any OpenAI-compatible API. Change these in `.env`:

**Groq (default):**
```
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
```

**OpenRouter:**
```
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-...
LLM_MODEL=meta-llama/llama-3.3-70b-instruct
```

**OpenAI:**
```
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

---

## Verifying Transactions

Every real payment creates a Stellar testnet transaction:

1. In the dashboard, go to **Activity** tab
2. Click any tx hash link — opens on [stellar.expert](https://stellar.expert/explorer/testnet)
3. Or click **"Agent Wallet on Explorer"** in the footer to see all agent transactions

You can also check balances directly:
```bash
curl -s "https://horizon-testnet.stellar.org/accounts/YOUR_AGENT_PUBLIC_KEY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for b in d['balances']:
    if b.get('asset_code') == 'USDC': print(f'USDC: {b[\"balance\"]}')
    elif b.get('asset_type') == 'native': print(f'XLM: {b[\"balance\"]}')
"
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `OZ_FACILITATOR_API_KEY required` | Generate at [channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen) |
| `LLM_API_KEY required` | Add your Groq/OpenRouter/OpenAI key to `.env` |
| Agent wallet has no USDC | Fund at [faucet.circle.com](https://faucet.circle.com) (Stellar Testnet) |
| x402 returns 500 | Check OZ facilitator key is valid; the facilitator may be temporarily down |
| Groq 429 rate limit | Wait for reset, or switch to a different model/provider |
| Dashboard can't connect | Ensure backend services are running (`npm run dev`) |
| Port already in use | Kill existing processes: `kill $(lsof -ti:3001,3002,3003,3004,3005)` |
