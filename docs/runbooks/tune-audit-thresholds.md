# Runbook: Tuning Bill-Audit Thresholds

This runbook describes how to configure and tune the medical bill audit multipliers in CareGuard.

## Environment Variables

Three environment variables control how the bill auditor flags overcharges and upcoding:

1. **`BILL_AUDIT_OVERCHARGE_MULTIPLIER`** (default `1.5`)
   - The threshold above which a charged amount is flagged as an error (e.g. 1.5x CMS fair market rate).
2. **`BILL_AUDIT_SUGGESTED_MULTIPLIER`** (default `1.2`)
   - The multiplier applied to CMS fair market rates to calculate the recommended/suggested billing amount for disputed items (e.g. 1.2x CMS fair market rate).
3. **`BILL_AUDIT_UPCODED_MULTIPLIER`** (default `3.0`)
   - The threshold above which an overcharge is classified as "upcoded" (extremely severe overcharging, e.g. 3.0x CMS fair market rate).

## Validation Rules

On server startup, CareGuard validates the configurations to ensure sanity. The following validation condition MUST be met:
```
BILL_AUDIT_UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0
```

If these criteria are not met, the server will log an error and refuse to start (throwing an error during boot).

## Tuning Guidelines

- **Medicare-like Strictness**: If the care recipient has Medicare and you want strict alignment with Medicare schedules:
  - Set `BILL_AUDIT_OVERCHARGE_MULTIPLIER=1.3`
  - Set `BILL_AUDIT_SUGGESTED_MULTIPLIER=1.1`
- **Commercial Insurance Tolerance**: If dealing with commercial providers where higher fees are standard:
  - Set `BILL_AUDIT_OVERCHARGE_MULTIPLIER=2.0`
  - Set `BILL_AUDIT_SUGGESTED_MULTIPLIER=1.5`
  - Set `BILL_AUDIT_UPCODED_MULTIPLIER=4.0`
