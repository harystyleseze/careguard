# Category budget examples for the Policy tab

The Policy tab lets you set the overall spending limits for a caregiver, then split that amount into category caps for medications and bills.

The labels you will see in the UI are:

- Daily Spending Limit ($)
- Monthly Spending Limit ($)
- Medication Monthly Budget ($)
- Bill Monthly Budget ($)
- Caregiver Approval Threshold ($)

## How the budgets work together

The agent checks spending in this order:

1. Daily spending limit
2. Monthly spending limit
3. Medication category budget
4. Bill category budget
5. Approval threshold

In plain language: the budget is a guardrail, not a suggestion.

If the total touches the daily limit or the monthly limit, the agent stops or pauses the transaction. If one category budget is reached, the agent cannot keep spending in that category without a caregiver review.

## Example 1: steady month with lower medication costs

A caregiver wants to keep healthcare costs modest but still allow medical bill payments.

| Setting | Value |
|---|---:|
| Daily Spending Limit ($) | 80 |
| Monthly Spending Limit ($) | 500 |
| Medication Monthly Budget ($) | 200 |
| Bill Monthly Budget ($) | 250 |
| Caregiver Approval Threshold ($) | 75 |

What this means:

- The family can spend up to $500 total in a month.
- Medication spending is capped at $200 for the month.
- Bill spending is capped at $250 for the month.
- The agent will ask for approval on any single payment above $75.

This leaves headroom for the month while still reserving enough for expected bills.

## Example 2: medication-heavy month

A caregiver is managing a person with multiple prescriptions and a few routine appointments.

| Setting | Value |
|---|---:|
| Daily Spending Limit ($) | 60 |
| Monthly Spending Limit ($) | 450 |
| Medication Monthly Budget ($) | 260 |
| Bill Monthly Budget ($) | 160 |
| Caregiver Approval Threshold ($) | 50 |

What this means:

- A medication-heavy month is allowed, but it is still capped.
- The overall monthly limit is $450, so combined medication + bills cannot exceed that amount.
- A large medication order would use part of the medication category first, then the overall monthly cap still applies.
- A payment above $50 requires caregiver approval.

This is a good setting if prescriptions are the main expense and the caregiver wants tighter daily control.

## Example 3: a month with higher medical bills

A caregiver expects a larger hospital or clinic bill and wants the system to reserve room for those costs.

| Setting | Value |
|---|---:|
| Daily Spending Limit ($) | 100 |
| Monthly Spending Limit ($) | 700 |
| Medication Monthly Budget ($) | 150 |
| Bill Monthly Budget ($) | 500 |
| Caregiver Approval Threshold ($) | 100 |

What this means:

- Medical bills can be higher, but the bill category is still limited to $500 for the month.
- Medication spending is kept lower to preserve room for larger bills.
- The agent still checks the all-in monthly limit of $700 before approving any purchase.

This works well for months when the priority is paying a large invoice without overusing the medication category.

## Example 4: a warning case to avoid

This is a configuration that looks reasonable at first glance, but it is too high in combined category totals.

| Setting | Value |
|---|---:|
| Daily Spending Limit ($) | 90 |
| Monthly Spending Limit ($) | 500 |
| Medication Monthly Budget ($) | 300 |
| Bill Monthly Budget ($) | 260 |
| Caregiver Approval Threshold ($) | 75 |

Here, the category budgets add up to $560 even though the monthly limit is $500.

That means:

- the combined categories exceed the overall monthly guardrail
- the Policy tab should show a warning before saving
- the caregiver should lower one or both category caps to keep them inside the monthly total

## A good rule of thumb

For most caregivers, it helps to keep:

- the monthly limit bigger than the sum of its category budgets
- the daily limit comfortably below the monthly cap
- the approval threshold low enough that unusually large purchases are reviewed

The exact numbers should match the real cost pattern of the household.

## Related reading

- [docs/SPENDING-POLICY.md](../SPENDING-POLICY.md)
- [dashboard/src/components/tabs/policy-tab.tsx](../../dashboard/src/components/tabs/policy-tab.tsx)
- [README.md](../../README.md)
