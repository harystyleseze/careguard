# Agent Spending Policy

CareGuard applies spending policy checks in this order:

1. `monthlyLimit` is the overall monthly cap across medications, bills, and service fees.
2. `medicationMonthlyBudget` and `billMonthlyBudget` are category caps inside that overall monthly cap.
3. `dailyLimit` caps same-day medication and bill payments in the caregiver's local timezone (see `timezone` below).
4. `approvalThreshold` decides whether an otherwise allowed payment needs caregiver approval.

Policy updates are rejected when `medicationMonthlyBudget + billMonthlyBudget > monthlyLimit`. Category budgets can be lower than the global cap, but they cannot promise more spending than the global monthly cap permits.

## Timezone (`timezone`)

The `timezone` field controls which calendar day the daily-limit check uses (Issue #207).

- **Type**: IANA timezone string (e.g. `"America/Phoenix"`, `"America/New_York"`, `"Europe/London"`).
- **Default**: Falls back to the `SPENDING_TIMEZONE` environment variable (default `"America/Phoenix"`).
- **Why it matters**: UTC midnight is 5 pm local time in Phoenix. Without a timezone, half a caregiver's day's spending would land on a different "UTC day" than their wall clock shows, causing the daily limit to reset at the wrong time.

### Example policy with timezone

```json
{
  "dailyLimit": 100,
  "monthlyLimit": 800,
  "medicationMonthlyBudget": 300,
  "billMonthlyBudget": 500,
  "approvalThreshold": 75,
  "holdTimeSeconds": 0,
  "timezone": "America/Phoenix"
}
```

### Setting the timezone via the API

```bash
curl -X POST http://localhost:3004/agent/policy \
  -H "Content-Type: application/json" \
  -d '{
    "dailyLimit": 100,
    "monthlyLimit": 800,
    "medicationMonthlyBudget": 300,
    "billMonthlyBudget": 500,
    "approvalThreshold": 75,
    "holdTimeSeconds": 0,
    "timezone": "America/Los_Angeles"
  }'
```
