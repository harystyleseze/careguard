# Agent Pause and Resume — A Guide for Caregivers

This guide explains what happens when the CareGuard agent pauses due to low wallet balance, what you should do, and how to get it running again.

---

## What the agent does

The CareGuard agent automatically compares medication prices, audits bills, checks drug interactions, and makes payments on your behalf. To do this, it needs funds in its Stellar wallet.

When the wallet balance drops too low, the agent **pauses** to avoid failed transactions. It will not attempt any payments or API queries until you top up the wallet and resume it.

---

## The low-balance banner

When the agent pauses, a **red banner** appears at the top of the dashboard:

> **Agent paused — low USDC balance.**
> USDC: 0.00 · XLM: 0.00. Fund the agent wallet with testnet USDC, then resume the agent.

Or:

> **Agent paused — low XLM balance.**
> USDC: 5.00 · XLM: 0.00. Fund the agent wallet with XLM (for transaction fees), then resume the agent.

The banner tells you:

1. **Which balance is low** — USDC (for payments) or XLM (for transaction fees)
2. **Current balances** — so you can see how much is there
3. **What to do** — fund the wallet, then click **Resume agent**

---

## What causes the pause

The agent pauses when either of these drops below a threshold:

| Balance | What it covers | Pause trigger |
|---|---|---|
| **USDC** | Medication orders, bill payments, API query fees | Balance too low to cover the next expected transaction |
| **XLM** | Stellar network transaction fees | Balance too low to pay Stellar transaction fees |

---

## What the agent stops doing during a pause

When paused, the agent will **not**:

- Compare medication prices
- Audit medical bills
- Check drug interactions
- Place medication orders
- Make bill payments
- Process any x402 API queries

The agent remains connected to the dashboard and will resume automatically once you click **Resume agent** after topping up.

---

## How to top up the wallet

### Adding USDC

1. Copy the agent's wallet address from the **Wallet tab** in the dashboard
2. Go to the [Circle USDC Faucet](https://faucet.circle.com)
3. Paste the wallet address and request testnet USDC
4. Wait a moment for the funds to appear

### Adding XLM

XLM is needed for Stellar transaction fees. You can get testnet XLM from the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account/create?network=testnet).

1. Open the Friendbot
2. Paste the agent's wallet address
3. Click **Get Test Network Lumens**

---

## How to resume the agent

After topping up the wallet:

1. Confirm the new balance on the **Wallet tab**
2. Click the **Resume agent** button on the red banner
3. The banner disappears and the agent resumes normal operation

You do not need to restart the dashboard or the server.

---

## Checking wallet balances

The **Wallet tab** shows:

- **USDC Balance** — funds for payments and API queries
- **XLM Balance** — funds for Stellar transaction fees
- **Wallet Address** — the agent's Stellar account address
- **Network** — which Stellar network you are on (testnet or mainnet)

If the wallet tab shows an error loading balances, click the **Retry** button.

---

## Tips

- **Check the Wallet tab regularly** — especially after the agent has been running for a while
- **Top up proactively** — don't wait for the pause banner; fund the wallet before it runs out
- **Use testnet faucets** — in the default setup, you are not using real money. See [Testnet Explained](testnet-explained.md) for details
- **Monitor the Activity tab** — it shows all payments the agent has made, so you can predict when you'll need to top up

---

## Related reading

- [Wallet Tab Guide](wallet-tab.md) — understanding the wallet display
- [Testnet Explained](testnet-explained.md) — why CareGuard uses testnet money
- [Getting Started](getting-started-caregiver.md) — full setup walkthrough
- [Spending Policy](spending-policy-for-caregivers.md) — configuring spending limits
