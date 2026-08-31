# Wallet Tab — A Guide for Caregivers

This guide explains what you see on the **Wallet tab** of the CareGuard dashboard: the balance display, the wallet address, and how to fund the agent's wallet.

---

## What the Wallet tab shows

The Wallet tab displays the agent's Stellar wallet information. It is organized into three sections:

### 1. Balances

Two cards at the top show:

| Card | What it shows |
|---|---|
| **USDC Balance** | The amount of USDC (a digital dollar) in the agent's wallet. This is the money the agent uses to pay for medications, bills, and API queries. |
| **XLM Balance** | The amount of XLM (Stellar's native token) in the agent's wallet. XLM is used to pay Stellar network transaction fees. |

### 2. Wallet Details

Below the balances:

| Field | What it means |
|---|---|
| **Wallet Address** | The agent's Stellar account address. You can copy this and use it to send funds to the wallet. |
| **Network** | Which Stellar network the agent is on — either "Stellar Testnet" or "Stellar Mainnet". |
| **LLM Provider** | The AI language model the agent uses for its decisions. |

### 3. Action Buttons

| Button | What it does |
|---|---|
| **View on Explorer** | Opens the agent's account on the Stellar blockchain explorer so you can see all transactions |
| **Fund Wallet** | Opens the Circle USDC faucet (testnet) so you can add funds |

---

## What the balance means

### USDC Balance

This is the agent's spending money. The agent uses USDC to:

- Pay for medication orders
- Pay for medical bills
- Pay for API queries (pharmacy comparisons, bill audits, drug interaction checks)

When the USDC balance drops too low, the agent pauses and you see a red **low-balance banner**. See [Agent Pause and Resume](agent-pause-and-resume.md) for what to do.

### XLM Balance

XLM is used for Stellar network transaction fees — the small cost of sending any transaction on Stellar. Even if you have plenty of USDC, the agent needs XLM to actually submit transactions.

If the XLM balance drops too low, the agent pauses even though it may still have USDC.

---

## Testnet vs. Mainnet

In the default setup, CareGuard runs on **Stellar Testnet**. This means:

- The USDC and XLM in the wallet are **testnet tokens** — they have no real-world value
- You can get free testnet funds from faucets
- All transactions are on a test network, not the live Stellar blockchain

If your CareGuard instance is configured for **Stellar Mainnet** (via `NEXT_PUBLIC_STELLAR_NETWORK=public`), the balances represent real funds. See [Testnet Explained](testnet-explained.md) for more details.

---

## How to fund the wallet

### Adding USDC (testnet)

1. Copy the agent's wallet address from the Wallet tab
2. Go to [faucet.circle.com](https://faucet.circle.com)
3. Paste the address and request testnet USDC
4. The funds appear in the wallet within a few seconds

### Adding XLM (testnet)

1. Copy the agent's wallet address from the Wallet tab
2. Go to the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account/create?network=testnet)
3. Paste the address and request testnet lumens
4. The funds appear within a few seconds

---

## How payments work

The Wallet tab includes a section explaining the three payment methods the agent uses:

| Method | What it pays for | How it works |
|---|---|---|
| **x402** | API queries (pharmacy prices, bill audits, drug interactions) | Per-request micropayment on Stellar using the x402 protocol |
| **MPP** | Medication orders | The agent signs a Stellar smart contract transfer; the pharmacy broadcasts the transaction |
| **USDC** | Bill payments | Direct Stellar USDC transfer from the agent's wallet |

You do not need to manage these payment methods separately — the agent handles all of this automatically.

---

## If the wallet tab shows an error

If the balance cards show a loading error:

1. Click the **Retry** button to fetch the balance again
2. If the error persists, check that the server is running and the wallet address is configured correctly

---

## Related reading

- [Agent Pause and Resume](agent-pause-and-resume.md) — what to do when the agent pauses
- [Testnet Explained](testnet-explained.md) — why CareGuard uses testnet money
- [Paying with x402](../api-examples/paying-with-x402.md) — how the x402 payment protocol works
- [Getting Started](getting-started-caregiver.md) — full setup walkthrough
