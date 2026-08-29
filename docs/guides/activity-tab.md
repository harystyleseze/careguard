# Activity Tab — A Guide for Caregivers

This guide explains what you see on the **Activity tab** of the CareGuard
dashboard: the agent log, the transaction and order history, and how to dig
deeper into any individual entry.

---

## What the Activity tab shows

The Activity tab is organized into two parts:

### 1. Agent log

A live, terminal-style feed at the top of the tab showing what the agent is
doing in real time — checking prices, evaluating spending policy, submitting
payments, and so on. Entries with an error attached can be expanded to see
the full error detail, and copied for troubleshooting.

### 2. Transaction and order history

A table below the log listing every completed action, newest first:

| Column | What it shows |
|---|---|
| **Time** | When the entry happened (hidden on narrow screens). |
| **Type** | `medication`, `bill`, `service_fee`, or `audit` for policy/system events. |
| **Description** | A short summary — the drug and pharmacy for a medication order, the bill description for a payment, or the audit event name. |
| **Amount** | The dollar amount, in USDC. |
| **Status** | `completed`, `blocked`, or `pending`, depending on the entry type. |
| **Stellar Tx** | A link to the transaction on the Stellar block explorer, when one exists. |

Use **Download Report** to export the full history (including pages not
currently in view) as a PDF, or **Reset** to clear all agent data — this is
destructive and cannot be undone.

---

## Medication orders specifically

When the agent places a medication order, the confirmation appears in this
same table as a `medication` entry. See
[Order Confirmation](order-confirmation.md) for exactly what details show up
and where to find a specific past order.

---

## Verifying a payment on-chain

Every row with a Stellar transaction hash links out to the block explorer so
you can independently confirm the payment happened. See
[Verifying a Payment](verifying-a-payment.md) for a full walkthrough, from
clicking the link in this tab to reading the result on stellar.expert.

---

## Related reading

- [Order Confirmation](order-confirmation.md) — what appears after a
  medication order is placed
- [Verifying a Payment](verifying-a-payment.md) — step-by-step guide to
  reading a transaction on stellar.expert
- [Wallet Tab](wallet-tab.md) — balances and funding, the other half of the
  payment picture
- [Testnet Explained](testnet-explained.md) — why the transactions you see
  here are testnet, not real money, by default
