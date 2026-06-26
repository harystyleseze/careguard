# Runbook: Tune bill-audit thresholds

**Symptom**

The bill audit service is flagging too many legitimate line items as overcharged/upcoded, or it is missing charges that operations expects to dispute.

**Impact**

Thresholds affect caregiver-facing bill audit results from `POST /bill/audit` in both the unified server and the standalone bill-audit API. Aggressive thresholds can create false positives and unnecessary disputes. Lenient thresholds can miss overcharges and reduce savings.

**Diagnosis**

Check the current environment:

```sh
printenv | grep BILL_AUDIT_
```

Current defaults:

| Env var | Default | Purpose |
|---|---:|---|
| `BILL_AUDIT_SUGGESTED_MULTIPLIER` | `1.2` | Corrected amount is `fair market rate * suggested` |
| `BILL_AUDIT_OVERCHARGE_MULTIPLIER` | `1.5` | Charge above `fair market rate * overcharge` is `overcharged` |
| `BILL_AUDIT_UPCODED_MULTIPLIER` | `3.0` | Charge above `fair market rate * upcoded` is `upcoded` |

The service validates this ordering at boot:

```text
BILL_AUDIT_UPCODED_MULTIPLIER > BILL_AUDIT_OVERCHARGE_MULTIPLIER > BILL_AUDIT_SUGGESTED_MULTIPLIER > 1.0
```

If the order is invalid, startup fails so the service cannot run with ambiguous billing policy.

**Mitigation**

For false positives, raise `BILL_AUDIT_OVERCHARGE_MULTIPLIER` in small increments, for example from `1.5` to `1.75`.

For missed overcharges, lower `BILL_AUDIT_OVERCHARGE_MULTIPLIER`, keeping it above `BILL_AUDIT_SUGGESTED_MULTIPLIER`.

For too many `upcoded` classifications, raise `BILL_AUDIT_UPCODED_MULTIPLIER`.

For corrected amounts that are too low or high, tune `BILL_AUDIT_SUGGESTED_MULTIPLIER`, keeping it below `BILL_AUDIT_OVERCHARGE_MULTIPLIER`.

Restart the service after changing env vars.

**Verification**

Run targeted tests:

```sh
npm test -- shared/__tests__/bill-audit-thresholds.test.ts
```

Then submit a known bill payload to confirm the expected status:

```sh
curl -X POST "$BILL_AUDIT_API_URL/bill/audit" \
  -H "Content-Type: application/json" \
  -d '{"lineItems":[{"description":"Office visit","cptCode":"99213","quantity":1,"chargedAmount":170}]}'
```

With defaults, this line is `valid` if the charge is at or below `1.5x` the fair market rate and `overcharged` above that threshold.

**Remediation**

If a new threshold set becomes permanent, update deployment env vars and `.env.example` together. Keep changes incremental and compare a sample of historical audits before and after the change.

The standalone bill-audit service can still use `services/bill-audit-api/audit_thresholds.json` for CPT-specific overcharge overrides. Env vars control the global defaults and the suggested/upcoded thresholds.

**Post-mortem template**

- Date / duration:
- Threshold values before:
- Threshold values after:
- Reason for tuning:
- Number of audits affected:
- False positive / false negative examples:
- Follow-up action items:

**Related**

- Issue [#73](https://github.com/harystyleseze/careguard/issues/73) - configurable bill-audit thresholds
- `shared/bill-audit-thresholds.ts` - env loader and audit classification helpers
- `services/bill-audit-api/server.ts` - standalone bill-audit API
- `server.ts` - unified production server
