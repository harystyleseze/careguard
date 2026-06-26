# Agent Spending Policy

CareGuard applies spending policy checks in this order:

1. `monthlyLimit` is the overall monthly cap across medications, bills, and service fees.
2. `medicationMonthlyBudget` and `billMonthlyBudget` are category caps inside that overall monthly cap.
3. `dailyLimit` caps same-day medication and bill payments in the configured spending timezone.
4. `approvalThreshold` decides whether an otherwise allowed payment needs caregiver approval.

Policy updates are rejected when `medicationMonthlyBudget + billMonthlyBudget > monthlyLimit`. Category budgets can be lower than the global cap, but they cannot promise more spending than the global monthly cap permits.
