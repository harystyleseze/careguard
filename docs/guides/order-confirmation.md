# Order Confirmation — A Guide for Caregivers

When the CareGuard agent places a medication order, this guide explains what
confirmation you'll see in the dashboard, where to find it later, and what to
do if something about the order needs to change.

---

## What happens when an order is placed

The agent submits the order and pays the pharmacy on Stellar. Once the
payment settles, the order is confirmed — there is no separate "pending
order" state to wait through once you see it in the dashboard.

## What the confirmation shows

The confirmed order appears as a new row in the **Activity tab**, with:

| Detail | Where it comes from |
|---|---|
| **Drug** | The medication name, as included in the order description. |
| **Pharmacy** | Which pharmacy fulfilled the order. |
| **Amount** | The dollar amount paid, in USDC. |
| **Status** | `completed` once the payment has settled on Stellar. |
| **Stellar transaction** | A link to the on-chain payment, so you can independently confirm it — see [Verifying a Payment](verifying-a-payment.md). |
| **Time** | When the order was confirmed. |

CareGuard does not currently show a separate order number, pharmacy contact
details, or a pickup/delivery estimate in the dashboard — the confirmation is
the transaction record itself (drug, pharmacy, amount, and the on-chain
receipt). If your pharmacy sends its own confirmation (text, email, or
in-store receipt) with a pickup time or order number, treat that as the
authoritative source for pickup logistics; CareGuard's role is to confirm the
order was placed and paid for, not to relay the pharmacy's fulfillment
details.

---

## Where to find past orders

All confirmed orders live in the **Activity tab**, listed newest first
alongside bill payments and other agent activity. To find a specific past
order:

1. Open the **Activity** tab.
2. Look for a row with type `medication` — the description names the drug
   and pharmacy.
3. If the order is older than the current page of results, use the
   pagination controls at the top of the table, or increase the page size.
4. Use **Download Report** to export the full history (including orders not
   on the currently visible page) as a PDF for your records.

See [Activity Tab](activity-tab.md) for the full breakdown of everything
shown in that view.

---

## If an order needs to be cancelled or corrected

CareGuard does not have an in-dashboard cancel or edit action for a
medication order once it's confirmed — the payment has already settled
on-chain by the time you see the confirmation, so there's nothing left in
CareGuard's own state to change.

If an order was placed in error, was for the wrong medication, or needs to
be cancelled:

1. **Contact the pharmacy directly.** Since the payment already settled,
   cancelling or correcting the order is a pharmacy-side fulfillment
   decision, the same as it would be for any other pharmacy order.
2. **Keep the transaction record.** The Stellar transaction link on the
   Activity tab row is your proof of payment — see
   [Verifying a Payment](verifying-a-payment.md) if the pharmacy needs you to
   confirm the payment independently.
3. **Check your spending policy if the concern is a budget issue**, not the
   order itself. See
   [Spending Policy for Caregivers](spending-policy-for-caregivers.md) to
   adjust limits going forward so a similar order doesn't recur unexpectedly.

---

## Related reading

- [Activity Tab](activity-tab.md) — everything shown in this tab, including
  bill payments and audit events alongside medication orders
- [Verifying a Payment](verifying-a-payment.md) — how to independently
  confirm the on-chain payment for an order
- [Wallet Tab](wallet-tab.md) — the balance the order was paid from
- [Spending Policy for Caregivers](spending-policy-for-caregivers.md) — how
  to adjust limits so future orders behave differently
