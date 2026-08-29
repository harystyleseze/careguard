# Medications Tab — A Guide for Caregivers

This guide explains what you see on the **Medications tab** of the CareGuard dashboard: the tracked medication list, the pharmacy price comparison, the savings figure, and how the agent uses this information to actually place an order.

---

## What the Medications tab shows

### 1. Tracked Medications

The Medications tab lists the medications CareGuard is watching prices for. Each row shows:

- The **medication name**
- Either the **best price found so far** (which pharmacy, and at what price), or a "not yet compared" note if the agent hasn't checked prices for that medication yet
- If a comparison has run, the **monthly savings** versus the most expensive pharmacy found, and the **savings percentage**

### 2. Drug Interaction Warnings

If the agent has run a drug interaction check across the tracked medications, a second panel appears below the medication list showing any interactions found, grouped by severity (severe, moderate, or minor), along with a plain-language recommendation for each one.

### 3. Download PDF

Once at least one price comparison has completed, a **Download PDF** button appears so you can save or print the price comparison and interaction results.

---

## Adding or removing tracked medications

In the current version of CareGuard, the medication list is a fixed starter set (Lisinopril, Metformin, Atorvastatin, and Amlodipine) rather than something you edit directly from the Medications tab — there is no "Add medication" button on this screen yet. If you need to track a different medication or dosage:

- Ask the agent directly (via the chat/interaction surface, if enabled in your deployment) to compare prices for a specific drug — this uses the same `compare_pharmacy_prices` tool behind the scenes and works for any medication, not just the four listed on this tab.
- For anything outside that ad-hoc use, check with whoever manages your CareGuard deployment, since editing the tracked list currently requires a code or configuration change rather than a dashboard action.

---

## Reading the pharmacy comparison results

When a comparison has run for a medication, the row shows something like:

> **Lisinopril** — Best: CVS Pharmacy at $4.25
> Save $5.50/mo — 56% savings

Here's what each part means:

| Field | What it means |
|---|---|
| **Best / pharmacy name / price** | The cheapest price found across all pharmacies the agent checked for this medication, and which pharmacy offers it. |
| **Save $X/mo** | The dollar difference between the cheapest price found and the most expensive price found, for a typical month's supply. This is potential savings from choosing the cheapest pharmacy over the priciest one — not necessarily versus what you're paying today. |
| **Savings %** | The same difference expressed as a percentage of the most expensive price. |

A comparison costs the agent a small fee (a fraction of a cent) each time it runs, paid automatically via the x402 protocol — you don't need to do anything for this to happen. See [Paying with x402](../api-examples/paying-with-x402.md) if you're curious how that payment mechanism works.

### Stock status

Behind the scenes, each pharmacy result also carries a stock status the agent uses to decide whether it's safe to order: **in stock**, or **unknown** (real-time inventory isn't available for that pharmacy). The agent is instructed to never assume a medication is available when stock status is unknown — it will confirm with the pharmacy first rather than order blind. This distinction isn't shown directly in the dashboard table, but it's why the agent may pause or check in before completing an order even after finding a good price.

---

## How the agent uses this data to place orders

Comparing prices and placing an order are two separate steps:

1. **Compare** — the agent calls the pharmacy price comparison tool, which is what populates the rows on this tab. This step only looks up prices; no money changes hands with the pharmacy and no medication is ordered.
2. **Pay and order** — if you (or your spending policy) approve going ahead, the agent separately calls a payment tool that submits the actual order and pays the chosen pharmacy via the MPP payment protocol on Stellar. This is a real USDC payment, subject to your configured spending limits.

The order is not placed automatically just because a cheaper price was found — placing an order is a distinct action the agent takes (or asks you to approve, depending on your spending policy's approval threshold and hold time). If a payment would exceed your budget, the agent reports back with the reason and either a suggested cheaper option or a request for you to approve a one-time override, rather than silently failing or overspending.

Once an order is paid for, it shows up as a **medication** entry in the [Activity tab](activity-tab.md), where you can also verify the payment on stellar.expert.

---

## Drug interaction warnings

Severity levels shown in the interaction panel:

| Severity | What it suggests |
|---|---|
| **severe** | A potentially dangerous combination — review the recommendation closely and consider discussing with a pharmacist or doctor before continuing both medications. |
| **moderate** | A combination worth being aware of; the recommendation explains what to watch for. |
| **minor** | A lower-risk interaction, included for completeness. |

This check is informational and does not block the agent from ordering a medication — always use clinical judgment (or consult a pharmacist/doctor) alongside these results rather than relying on them as a substitute for medical advice.

---

## Related reading

- [Activity Tab](activity-tab.md) — see completed medication orders and verify their Stellar transactions
- [Spending Policy for Caregivers](spending-policy-for-caregivers.md) — how budgets, holds, and approval thresholds affect whether an order goes through automatically
- [Paying with x402](../api-examples/paying-with-x402.md) — how the agent pays for price comparisons
- [Wallet Tab](wallet-tab.md) — the wallet balance the agent draws from to pay for orders
