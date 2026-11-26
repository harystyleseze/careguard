# Runbook: Pharmacy Catalog Gap / Label-Cardinality Abuse

**Symptom**

One of two alerts fires in Prometheus:

1. **`PharmacyUnknownDrugRateHigh`** — the rate of pharmacy price lookups for
   drugs not in the catalog exceeds 5/min sustained for 10 min. This means
   clients are repeatedly requesting prices for drugs the pharmacy service
   does not recognize.

2. **`PharmacyUnknownDrugCardinalityHigh`** — the number of distinct `drug`
   label values on `pharmacy_unknown_drug_total` exceeds 100. This is a
   label-cardinality warning: each unique drug string creates a separate
   Prometheus time series, and unbounded growth degrades Prometheus memory
   and scrape performance.

**Impact**

- **Catalog gaps:** Caregivers may be requesting prices for legitimate
  medications that are simply missing from the pharmacy catalog. The agent
  cannot compare prices for these drugs, so it cannot find savings or check
  interactions for them. Caregiver trust erodes when the agent cannot help
  with a specific medication.

- **Cardinality abuse:** If the `drug` label is being populated with arbitrary
  client-supplied strings (typos, free-form input, injection attempts), each
  unique string creates a new Prometheus time series. At scale this causes
  Prometheus memory growth, slow scrapes, and degraded query performance. This
  is the one known high-cardinality label violation documented in
  [metrics-naming.md](../observability/metrics-naming.md) §2.1 and §3.

## Diagnosis

1. **Check which drugs are unknown.** Query Prometheus for the top unknown
   drugs by lookup count:
   ```promql
   topk(20, pharmacy_unknown_drug_total)
   ```
   This shows the 20 most frequently looked-up unknown drug names.

2. **Distinguish catalog gaps from abuse.** Look at the drug strings:
   - **Catalog gap:** Drug names that look like real medications (e.g.
     `lisinopril`, `metformin_500mg`) but aren't in the catalog. These should
     be added to the pharmacy catalog.
   - **Cardinality abuse:** Strings that are clearly not drug names (e.g.
     random strings, URLs, very long strings, repeated variations of the
     same drug with typos). These indicate the client is sending unsanitized
     input.

3. **Check the cardinality count.** Query Prometheus:
   ```promql
   count(count by (drug) (pharmacy_unknown_drug_total))
   ```
   If this is growing over time, the label set is unbounded and needs capping.

4. **Check the pharmacy catalog.** Look at the drug catalog used by the
   pharmacy price API service to see which drugs are currently listed:
   ```sh
   ls services/pharmacy-api/data/
   ```

## Mitigation

**For catalog gaps:**

1. Add the missing drug to the pharmacy catalog so future lookups succeed.
2. If the drug is a legitimate medication, add it with correct pricing data
   from the configured pharmacy providers.

**For cardinality abuse:**

1. **Immediate:** The `drug` label on `pharmacy_unknown_drug_total` is the
   one known high-cardinality violation in the codebase (see
   [metrics-naming.md](../observability/metrics-naming.md) §3). If the
   cardinality is growing rapidly, consider dropping the `drug` label
   entirely and replacing it with a low-cardinality label like
   `drug_known=false` (a fixed single-value set).

2. **Input sanitization:** Ensure the pharmacy price API sanitizes the drug
   name input before using it as a label value. Truncate long strings, reject
   non-alphanumeric characters, or map unknown drugs to a single
   `drug="unknown"` label.

3. **Restart Prometheus** if memory pressure is severe. Cardinality is
   reduced only when the old series age out of the retention window or
   Prometheus is restarted (which drops in-memory series).

## Remediation

1. **Fix the catalog:** Add any legitimate missing drugs to the pharmacy
   catalog so the `pharmacy_unknown_drug_total` counter stops incrementing
   for them.

2. **Cap the label:** Per metrics-naming.md §3, the long-term fix is to
   replace the unbounded `drug` label with a bounded alternative:
   - Option A: Drop the `drug` label entirely and use a single
     `drug="unknown"` label value for all unknown-drug lookups.
   - Option B: Map drug names to a fixed safe-set (e.g. top 20 commonly
     requested drugs) and bucket everything else as `other`.

3. **Validate the alert thresholds.** The `PharmacyUnknownDrugCardinalityHigh`
   alert threshold (100 distinct labels) is 5× the ~20 unique-value limit
   in metrics-naming.md §2.1. If your deployment has a larger legitimate
   drug catalog, adjust the threshold in `docker/prometheus/rules.yml`.

## Post-mortem template

```
Date / duration:
Alert that fired: [ PharmacyUnknownDrugRateHigh | PharmacyUnknownDrugCardinalityHigh ]
Distinct drug labels at time of alert:
Top unknown drugs:
Root cause: [ catalog gap | unsanitized client input | label cardinality abuse ]
Detection lag:
Mitigation taken: [ added drugs to catalog | dropped/sanitized label | restarted Prometheus ]
Remediation:
Action items:
```

## Related

- [metrics-naming.md](../observability/metrics-naming.md) §2.1 (label cardinality limits), §3 (audit of `pharmacy_unknown_drug_total`)
- [metrics-catalog.md](../observability/metrics-catalog.md) — `pharmacy_unknown_drug_total` entry and Known gaps section
- `docker/prometheus/rules.yml` — `PharmacyUnknownDrugRateHigh` and `PharmacyUnknownDrugCardinalityHigh` alert definitions
- `shared/metrics.ts` — `pharmacyUnknownDrugTotal` counter definition (lines 113–118)
