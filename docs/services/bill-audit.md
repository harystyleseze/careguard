# Bill Audit Service

## Overview

The Bill Audit API (`services/bill-audit-api/server.ts`) audits medical bill line items for overcharges, duplicate charges, and upcoding by comparing charged amounts against CMS Medicare fair-market rates.

## Fair Market Rate Lookup

The `auditBill` function looks up each line item's CPT code in `FAIR_MARKET_RATES`. The result is:

- **`fairAmount: number`** — fair rate × quantity, when the CPT code is found in the database
- **`fairAmount: null`** — when the CPT code is unknown (no fair rate available)

### Important: `null` vs `0`

`fairAmount` can legitimately be `0` (e.g., preventive services with $0 fair market rate covered by insurance). The code distinguishes between:

| fairAmount | Meaning | Behaviour |
|-----------|---------|-----------|
| `null` | CPT code not in database | Item passes through as "valid" at the charged amount |
| `0` | CPT code found, fair rate is $0 | Overcharge detection applies: any charge > $0 is flagged |

**Never use truthy-coercion** (`if (fairAmount)` or `fairAmount ? ... : ...`) to check whether a fair rate was found. Always check `fairAmount !== null`.

## Audit Logic

For each line item with a known fair rate:

1. **Duplicate detection** — Same CPT code appearing more than once (except allowed therapy codes `96372`, `97110`)
2. **Overcharge** — Charged amount > 1.5× fair rate
3. **Upcoding** — Charged amount > 3× fair rate (a subset of overcharges, suggesting a wrong billing code)
4. **Valid** — Within 1.5× fair rate, or fair rate is unknown (`null`)

The suggested amount caps at 1.2× the fair rate for overcharged items.
