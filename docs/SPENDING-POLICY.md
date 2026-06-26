# Spending Policy

CareGuard enforces five limits on every payment the agent makes:

| Field | Default | Description |
|---|---|---|
| `dailyLimit` | $100 | Maximum total spending (medications + bills) within one calendar day in the caregiver's timezone |
| `monthlyLimit` | $800 | Maximum total spending within the current calendar month |
| `medicationMonthlyBudget` | $300 | Monthly cap for medication payments only |
| `billMonthlyBudget` | $500 | Monthly cap for bill payments only |
| `approvalThreshold` | $75 | Payments above this amount require explicit caregiver approval |

## Enforcement Model

The spending policy is enforced server-side by the agent before every payment. It is not enforced by a Soroban smart contract.

Before `payForMedication` or `payBill` submits a payment, `checkSpendingPolicy` in `agent/tools.ts` reads the current policy, compares the proposed payment with the daily, monthly, category, and approval-threshold limits, and returns an allow/deny decision. The dashboard Policy tab updates that server-side policy; it does not create an on-chain rule.

If a payment is denied, the agent should stop before submitting the payment request. If a payment needs approval, the agent should hold the payment until the caregiver approves it through the normal approval flow.

## Threat Model

This model protects against normal agent workflows accidentally or intentionally exceeding configured caregiver limits. It assumes the CareGuard server and its persisted policy/transaction data are trusted inputs to the payment decision.

It does not protect against:

- direct database or filesystem writes that alter the stored policy or transaction history
- a compromised server process or deployment environment
- direct use of the underlying wallet outside the CareGuard agent
- a future service that submits payments without calling `checkSpendingPolicy`

Any future on-chain spending-policy contract should be tracked as a separate design and implementation issue.

## Daily Limit and Timezones

The daily limit resets at **local midnight** in the caregiver's timezone, not UTC midnight.

### Why this matters

A caregiver in Phoenix (UTC−7) would otherwise see their "day" reset at 5 pm local time, meaning a prescription ordered at 6 pm local would count toward the *next* UTC day. This allows the daily limit to be exceeded from the caregiver's perspective.

### Configuration

Set `SPENDING_TIMEZONE` in `.env` to any IANA timezone name:

```
SPENDING_TIMEZONE=America/Phoenix   # default — UTC-7, no DST
SPENDING_TIMEZONE=America/New_York  # Eastern
SPENDING_TIMEZONE=America/Chicago   # Central
SPENDING_TIMEZONE=America/Denver    # Mountain
SPENDING_TIMEZONE=America/Los_Angeles # Pacific
SPENDING_TIMEZONE=UTC               # UTC (legacy behavior)
```

The default is `America/Phoenix` because it matches the CareGuard caregiver persona and is a fixed UTC−7 offset year-round (Arizona does not observe Daylight Saving Time).

### Implementation

`agent/tz.ts` exports `getLocalDateStr(tz, date?)` which uses `Intl.DateTimeFormat('en-CA', { timeZone: tz })` to format a date as `YYYY-MM-DD` in the given timezone. `checkSpendingPolicy` in `agent/tools.ts` calls this to determine both "today" and the date of each past transaction before comparing.

## Updating the Policy

Use the **Policy** tab in the dashboard to update limits in real time. The agent reads the current policy before every payment attempt.

Limits are validated client-side and server-side:

- All values must be finite, non-negative, and ≤ 10 000
- `dailyLimit` must not exceed `monthlyLimit`
- `medicationMonthlyBudget + billMonthlyBudget` must not exceed `monthlyLimit`
- `approvalThreshold` must not exceed the smallest of `dailyLimit`, `medicationMonthlyBudget`, and `billMonthlyBudget`

## Limits of Enforcement

Policy checks are only as accurate as the stored policy and transaction history available to the agent. Restart-safe persistence and transaction logging are therefore part of the enforcement boundary, but they are still application-level controls rather than blockchain-level controls.
