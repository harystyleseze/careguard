# Activity Tab — A Guide for Caregivers

This guide explains what you see on the **Activity tab** of the CareGuard dashboard: the live agent log, the transaction and audit timeline, and how to verify any entry on the Stellar blockchain.
This guide explains what you see on the **Activity tab** of the CareGuard
dashboard: the agent log, the transaction and order history, and how to dig
deeper into any individual entry.

---

## What the Activity tab shows

The Activity tab has two parts, stacked top to bottom.

### 1. Agent Log

A dark, terminal-style panel showing a running log of what the agent is doing right now — for example, "Comparing prices for Lisinopril" or "Submitting order to CVS Pharmacy". This is a live feed, not a permanent record: clicking **Clear Log** empties it, and it resets when the page reloads. If an entry failed, it appears with an arrow (▸) you can click to expand the error detail, plus a **Copy error** button for sharing the exact message with support.

### 2. Activity Table

Below the log is a table combining two kinds of history into a single timeline, newest first:

- **Transactions** — money the agent spent or moved
- **Audit events** — actions the agent took that didn't necessarily involve money (e.g. a policy check or a paused action)

Each row shows a time, a type, a description, an amount, a status, and a Stellar transaction link where one applies.

---

## Entry types explained

| Type badge | What it means |
|---|---|
| **medication** | The agent paid a pharmacy to fill or refill a tracked medication. |
| **bill** | The agent paid a medical bill on your behalf. |
| **service_fee** | A small payment the agent made to use a paid data service — for example, a pharmacy price comparison, a bill audit, or a drug interaction check. These are usually a few cents or less. |
| **audit** (dark badge) | A non-payment event, such as a spending-policy update, a blocked action, or the agent pausing itself. The **Description** column names the event and, if relevant, which tool was involved. |

### Reading the "price check, order, audit, payment" entries

- A **price check** shows up as a `service_fee` transaction — the agent paid a small fee to compare pharmacy prices.
- An **order** shows up as a `medication` transaction — the actual cost of filling the prescription.
- A **payment** for a bill shows up as a `bill` transaction.
- An **audit** entry (dark badge) records something the agent *did* rather than something it *paid for* — for instance, "Spending Policy Updated" or a blocked transaction.

### Status column

Each transaction also carries a status:

| Status | Meaning |
|---|---|
| **completed** | The payment settled successfully on Stellar. |
| **blocked** | Your spending policy stopped this payment before it happened — no money moved. |
| Anything else (e.g. pending/held) | The payment is still in progress, often waiting out a hold period before it settles. See [Spending Policy for Caregivers](spending-policy-for-caregivers.md) for how holds work. |

Audit rows show the **actor** (who or what triggered the event) in the status column instead of a payment status, since no money is involved.

---

## Verifying a transaction on stellar.expert

Every settled transaction shows a short transaction hash under **Stellar Tx** — this is your receipt, independent of anything CareGuard tells you. Because it's on a public blockchain, you can verify it yourself:

1. Find the row for the transaction you want to check in the Activity table.
2. Look at the **Stellar Tx** column. If you see a shortened hash (like `a1b2c3...e5f6`), the payment was verified and settled on-chain.
3. Click the hash — it opens directly on the Stellar blockchain explorer in a new tab, already pointed at that transaction.
4. On the explorer page, confirm:
   - The **amount** matches what's shown in the Activity table.
   - The **destination address** matches the pharmacy, biller, or service you expect.
   - The transaction status is **Successful**.

If you'd rather look it up manually, copy the full hash (hover over the link to see it, or use "Copy error" style inspection in your browser) and paste it into the search bar at [stellar.expert](https://stellar.expert). Search transaction hashes on the correct network — Testnet or Public (Mainnet) — matching whichever network your CareGuard instance is configured for. See [Testnet Explained](testnet-explained.md) if you're not sure which one you're on.

### If the Stellar Tx column shows "unverifiable"

Occasionally you'll see a yellow **⚠ unverifiable** label instead of a link. This means the agent made a payment through the x402 protocol but the system could not automatically extract the underlying Stellar transaction hash from the payment receipt. The payment still happened — it just can't be one-click verified from the dashboard. If you need to confirm it, check the wallet's full transaction history on stellar.expert directly (see [Wallet Tab](wallet-tab.md) for the wallet address) around the timestamp shown.

A plain dash (`-`) means no Stellar transaction applies to that row at all — this is normal for audit entries, since they don't represent a payment.

---

## Filtering and searching activity

The Activity tab does not currently offer a text search or category filter — every transaction and audit event for the care recipient appears in one combined, chronological table. You can narrow what you're looking at in these ways instead:

- **Pagination controls** at the top of the table let you choose how many rows to view per page (10, 25, 50, or 100) and step through Previous/Next pages once there's more history than fits on one page.
- **Download Report** exports the full transaction history (all pages, not just the one in view) as a PDF you can search, save, or share — useful if you need to look for a specific medication, amount, or date.
- **Sorting** is fixed to newest-first; there's no way to reverse it from the dashboard.

If you need to find a specific transaction quickly, downloading the report and using your PDF viewer's search (Ctrl+F / Cmd+F) is the most reliable option today.

---

## Clearing history

- **Clear Log** only clears the live agent log panel (the terminal-style feed). It does not delete any transactions or audit events.
- **Reset** (in red) is destructive: it permanently deletes all transactions, the agent log, and all audit results for this care recipient. CareGuard asks you to confirm before this happens, and the confirmation dialog tells you exactly how many transactions will be lost. This cannot be undone — use it only if you intend to start fresh.
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

- [Wallet Tab](wallet-tab.md) — the agent's wallet address and balances, needed to look up full transaction history on stellar.expert
- [Spending Policy for Caregivers](spending-policy-for-caregivers.md) — how holds, budgets, and blocked payments work
- [Medications Tab](medications-tab.md) — where price checks and orders are initiated
- [Testnet Explained](testnet-explained.md) — whether your transactions are on testnet or real Stellar mainnet
- [Order Confirmation](order-confirmation.md) — what appears after a
  medication order is placed
- [Verifying a Payment](verifying-a-payment.md) — step-by-step guide to
  reading a transaction on stellar.expert
- [Wallet Tab](wallet-tab.md) — balances and funding, the other half of the
  payment picture
- [Testnet Explained](testnet-explained.md) — why the transactions you see
  here are testnet, not real money, by default
