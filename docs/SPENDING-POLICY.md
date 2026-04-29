# Spending Policy

CareGuard enforces five limits on every payment the agent makes:

| Field | Default | Description |
|---|---|---|
| `dailyLimit` | $100 | Maximum total spending (medications + bills) within one calendar day in the caregiver's timezone |
| `monthlyLimit` | $500 | Maximum total spending within the current calendar month |
| `medicationMonthlyBudget` | $300 | Monthly cap for medication payments only |
| `billMonthlyBudget` | $500 | Monthly cap for bill payments only |
| `approvalThreshold` | $75 | Payments above this amount require explicit caregiver approval |

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
- `approvalThreshold` must not exceed the smallest of `dailyLimit`, `medicationMonthlyBudget`, and `billMonthlyBudget`
