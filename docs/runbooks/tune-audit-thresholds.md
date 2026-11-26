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

## Game-Day Drill: Boot-Time Multiplier Validation

Rehearse the boot-time safety net in staging to confirm invalid multiplier combinations refuse to start:

1. **Invalid Case 1 (`UPCODED <= OVERCHARGE`):** Start with `BILL_AUDIT_UPCODED_MULTIPLIER=2.0 BILL_AUDIT_OVERCHARGE_MULTIPLIER=2.0 BILL_AUDIT_SUGGESTED_MULTIPLIER=1.2` and confirm boot fails with `Invalid bill-audit multipliers config: must satisfy UPCODED > OVERCHARGE > SUGGESTED > 1.0`.
2. **Invalid Case 2 (`SUGGESTED <= 1.0`):** Start with `BILL_AUDIT_SUGGESTED_MULTIPLIER=1.0` (and `0.9`) and confirm boot fails with the same clear error.
3. **Valid Configurations:** Start with the Medicare-strictness (`1.3 / 1.1 / 3.0`) and Commercial-tolerance (`2.0 / 1.5 / 4.0`) examples above and confirm the server boots cleanly.
4. **Error Clarity & Follow-ups:** Confirm the error output includes the configured values for fast operator diagnosis.

| Date | Environment | Invalid Cases Refused? | Valid Presets Booted? | Follow-ups |
|------|-------------|------------------------|-----------------------|------------|
| _TBD_ | staging | _TBD_ | _TBD_ | _TBD_ (#968) |
