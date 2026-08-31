# Verifying a Payment on stellar.expert — A Guide for Caregivers

CareGuard says every payment is "verifiable on stellar.expert." This guide
walks through exactly how to do that, starting from an entry in the
dashboard's Activity tab and ending on the transaction's page in the
explorer.

You don't need any technical or crypto background to follow these steps.

---

## Step 1: Open the Activity tab

In the CareGuard dashboard, click the **Activity** tab. You'll see a table
of past transactions and orders, newest first.

## Step 2: Find the entry you want to verify

Each row shows a type (`medication`, `bill`, or `service_fee`), a
description, an amount, and a status. Find the row for the payment you want
to check.

## Step 3: Click the Stellar Tx link

On the right side of the row, in the **Stellar Tx** column, you'll see one
of three things:

| What you see | What it means |
|---|---|
| A short code like `a1b2c3...9f8e` | A working link — click it to open the transaction on stellar.expert. |
| `⚠ unverifiable` | The transaction hash could not be captured for this entry. The payment may still have succeeded, but it cannot be checked on-chain from CareGuard. |
| `-` | No transaction hash exists for this entry (for example, an audit or policy event that didn't move money). |

Click the short code to open stellar.expert in a new tab.

## Step 4: Read the transaction on stellar.expert

The explorer page shows several sections. The ones that matter for
confirming a payment:

| What to look for | Where it is | What it should match |
|---|---|---|
| **Amount** | Under "Operations," look for a "Payment" or "Invoke Contract" operation | The dollar amount shown in the Activity tab row |
| **Asset** | Next to the amount | `USDC` for medication orders and bill payments |
| **Timestamp** | Near the top of the page, or under "Created at" | The time shown in the Activity tab row (allow a few seconds' difference — the dashboard timestamp is when the entry was recorded, not the exact ledger close time) |
| **Successful** | A green "Successful" badge near the top | Confirms the transaction was accepted by the network, not just submitted |
| **Source account** | Near the top | The agent's wallet address, shown on the [Wallet tab](wallet-tab.md) |

If the amount, asset, and rough timestamp all line up with what you saw in
the Activity tab, the payment is confirmed on-chain.

---

## Testnet vs. mainnet: how to tell them apart

This is the detail people miss most often, because the two explorer pages
look almost identical.

- **Look at the URL.** A testnet transaction is at
  `stellar.expert/explorer/testnet/tx/<hash>`. A mainnet (real-money)
  transaction is at `stellar.expert/explorer/public/tx/<hash>`. The word
  `testnet` or `public` right after `/explorer/` is the tell.
- **Look for a banner.** stellar.expert shows a distinct banner or color
  treatment on testnet pages warning that you're viewing test network data.
- **Check which network CareGuard is configured for.** By default, CareGuard
  runs on Stellar **testnet** — meaning the USDC and XLM involved are test
  tokens with no real-world value, even though the workflow behaves exactly
  like it would in production. The link that CareGuard generates for you
  already points at the correct network for your instance, so if you always
  click through from the Activity tab (rather than pasting a hash into
  stellar.expert's search bar by hand), you'll land on the right page
  automatically. See [Testnet Explained](testnet-explained.md) for the full
  picture.
- **If you're checking manually**, always confirm the network in the URL
  before treating any balance or transaction as real money.

---

## If the link doesn't work or the transaction isn't found

- **`⚠ unverifiable` in the Activity tab** — the payment likely still went
  through (CareGuard would show a `blocked` status otherwise), but the
  on-chain hash wasn't captured for that entry. There's nothing to click
  through to verify in this case; treat the dashboard status as the source
  of truth for that entry.
- **"Not Found" on stellar.expert** — double-check you're on the right
  network (testnet vs. mainnet, above). A testnet hash will never resolve on
  the mainnet explorer page and vice versa.
- **Amount or timestamp doesn't match** — this would be unexpected; if you
  see a genuine mismatch between what the Activity tab reports and what the
  explorer shows, treat it as worth flagging rather than dismissing it.

---

## Related reading

- [Activity Tab](activity-tab.md) — everything else shown in this tab
- [Order Confirmation](order-confirmation.md) — what appears right after a
  medication order is placed
- [Wallet Tab](wallet-tab.md) — the agent's wallet address and balances
- [Testnet Explained](testnet-explained.md) — why CareGuard uses testnet
  money by default and what that means for you
