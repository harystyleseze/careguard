# Spending Policy Settings — A Guide for Caregivers

This guide explains every setting you see in the **Policy tab** of the CareGuard dashboard. You do not need any technical background to use it.

For the technical reference, see [docs/SPENDING-POLICY.md](../SPENDING-POLICY.md).

---

## What the Policy tab does

The Policy tab lets you set spending limits for the CareGuard agent. These limits control how much the agent can spend on medications and bills on behalf of your care recipient.

Every limit is enforced in real time. The agent checks the current policy before every payment and stops if a limit would be exceeded.

---

## Settings at a glance

| Setting | What it means |
|---|---|
| Daily Spending Limit ($) | The most the agent can spend in a single day |
| Monthly Spending Limit ($) | The most the agent can spend in a calendar month |
| Medication Monthly Budget ($) | The most the agent can spend on medications in a month |
| Bill Monthly Budget ($) | The most the agent can spend on medical bills in a month |
| Caregiver Approval Threshold ($) | Any single payment above this amount requires your approval |
| Hold Time Before Auto-Approval (seconds) | How long a pending payment waits before being auto-approved |

---

## Setting each limit

### Daily Spending Limit ($)

This is the maximum total the agent can spend in one day, combining both medications and bills.

**Example:** If you set this to $50, the agent will not spend more than $50 in a single day. If a medication order for $30 goes through in the morning, the agent can only spend up to $20 more before the day resets.

The day resets at midnight in your local timezone.

### Monthly Spending Limit ($)

This is the maximum total the agent can spend in a calendar month across all categories.

**Example:** If you set this to $400, the agent will stop all spending once the combined medication and bill total reaches $400 for the month. You would need to increase the limit or wait until next month for the agent to resume spending.

### Medication Monthly Budget ($)

This caps how much the agent can spend on medications alone in a month.

**Example:** If you set this to $200, the agent will not order medications once $200 has been spent on drugs for the month — even if the overall monthly limit has not been reached.

### Bill Monthly Budget ($)

This caps how much the agent can spend on medical bills in a month.

**Example:** If you set this to $250, the agent will not pay any bill once $250 has been spent on bills for the month.

### Caregiver Approval Threshold ($)

Any single payment above this amount will be held for your review before the agent completes it.

**Example:** If you set this to $75, a $60 medication order goes through automatically, but a $120 bill payment will pause and wait for you to approve it in the dashboard.

### Hold Time Before Auto-Approval (seconds)

When a payment is held for your approval, this setting controls how long it waits. After this time, the payment is automatically approved if you have not acted on it.

**Example:** If you set this to 3600 seconds (1 hour), a pending payment will wait one hour for your response before being auto-approved.

---

## How the limits work together

The agent checks limits in this order:

1. **Daily Spending Limit** — Has the agent already spent too much today?
2. **Monthly Spending Limit** — Has the agent already spent too much this month?
3. **Medication Monthly Budget** — Has the medication budget been used up?
4. **Bill Monthly Budget** — Has the bill budget been used up?
5. **Approval Threshold** — Is this single payment above the threshold?

If any limit is exceeded, the agent stops or asks for your approval.

---

## Worked examples

### Example 1: Modest monthly budget

| Setting | Value |
|---|---|
| Daily Spending Limit ($) | 80 |
| Monthly Spending Limit ($) | 500 |
| Medication Monthly Budget ($) | 200 |
| Bill Monthly Budget ($) | 250 |
| Caregiver Approval Threshold ($) | 75 |

What this means for you:

- The agent can spend up to $500 total in a month.
- Medications are capped at $200 for the month.
- Bills are capped at $250 for the month.
- Any single payment above $75 will ask for your approval first.
- The agent will not spend more than $80 in a single day.

### Example 2: Medication-heavy month

| Setting | Value |
|---|---|
| Daily Spending Limit ($) | 60 |
| Monthly Spending Limit ($) | 450 |
| Medication Monthly Budget ($) | 260 |
| Bill Monthly Budget ($) | 160 |
| Caregiver Approval Threshold ($) | 50 |

What this means for you:

- The agent can spend more on medications ($260) than bills ($160).
- The overall monthly cap is $450, so combined spending stays within that.
- Any payment above $50 needs your approval.
- Daily spending is capped at $60.

### Example 3: Higher medical bills expected

| Setting | Value |
|---|---|
| Daily Spending Limit ($) | 100 |
| Monthly Spending Limit ($) | 700 |
| Medication Monthly Budget ($) | 150 |
| Bill Monthly Budget ($) | 500 |
| Caregiver Approval Threshold ($) | 100 |

What this means for you:

- The agent can pay larger medical bills (up to $500 for bills).
- Medication spending is kept lower at $150.
- Payments above $100 require your approval.
- The agent can spend up to $100 in a single day.

---

## Common questions

### What happens when a limit is reached?

The agent stops making payments in that category. For the daily and monthly limits, all spending stops. For a category budget (medications or bills), only that category stops — the other category can still be used if it has remaining budget.

### Can I change limits after setting them?

Yes. You can update any setting at any time from the Policy tab. The agent reads the current policy before every payment, so changes take effect immediately.

### What happens if I raise a limit?

The dashboard will ask you to confirm any limit increase. If you more than double a limit, you will need to type **CONFIRM** to proceed. This is a safety check to make sure limit increases are intentional.

### What if the medication and bill budgets add up to more than the monthly limit?

The dashboard will show a warning. The monthly limit is the overall cap, so the category budgets should not exceed it. Adjust one or both categories to stay within the monthly total.

### Can I disable payments entirely?

Set all limits to their minimum values and the agent will not be able to make any payments. You can then review and approve each one individually through the approval threshold.

---

## Tips for setting good limits

- Start with conservative limits and increase them as you get comfortable with the agent's spending patterns.
- Keep the daily limit below the monthly limit so spending is spread across the month.
- Set the approval threshold low enough that unusually large payments get your attention.
- Review the Activity tab regularly to see what the agent has been spending.

---

## Related reading

- [Category budget examples](category-budgets-examples.md) — detailed examples of how category budgets interact with the monthly cap
- [docs/SPENDING-POLICY.md](../SPENDING-POLICY.md) — technical reference for the spending policy engine
- [Testnet explained](testnet-explained.md) — why CareGuard runs on Stellar testnet
