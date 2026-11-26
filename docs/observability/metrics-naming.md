# Metrics Naming and Labelling Conventions

> **Cross-links:** [metrics-catalog.md](./metrics-catalog.md) · [slo.md](./slo.md) ·
> [`shared/metrics.ts`](../../shared/metrics.ts) · [CONTRIBUTING.md](../../CONTRIBUTING.md)

This guide defines the naming and labelling conventions every contributor must
follow when adding or modifying a metric in CareGuard.  It also audits the
existing metrics in `shared/metrics.ts` against these conventions, lists the
known deviations, and provides a checklist for adding a new metric.

---

## 1. Naming conventions

### 1.1 Prefix

Every metric **must** be prefixed with the service or subsystem it belongs to,
followed by an underscore.

| Subsystem | Prefix |
|-----------|--------|
| Agent runtime | `agent_` |
| Stellar / payments | `stellar_` or `payments_` |
| x402 protocol | `x402_` |
| Pharmacy service | `pharmacy_` |
| Bill audit service | `bill_audit_` |
| Spending policy | `policy_` or `payment_` |

### 1.2 Counter suffix — `_total`

All counters **must** end in `_total` (the Prometheus / OpenMetrics standard).

```
# Good
agent_runs_total
stellar_tx_submitted_total

# Bad  ← missing _total
agent_runs
stellar_txs_submitted
```

### 1.3 Unit suffix

Metrics that measure a quantity in a specific unit **must** include the base
unit as the final component before `_total` (for counters) or at the end (for
gauges / histograms).

| Quantity | Base unit suffix |
|----------|-----------------|
| Duration / latency | `_seconds` (not `_ms`, not `_milliseconds`) |
| Byte count | `_bytes` |
| USD / USDC amounts | `_usd` or `_usdc` |

**Exception:** `agent_llm_latency_ms` currently uses `_ms` — this is a known
deviation (see §3) that should be migrated to `_seconds` in a follow-up.

### 1.4 Base-unit policy

Use Prometheus base units.  Do **not** pre-scale.

| Measure | Store as |
|---------|----------|
| 500 milliseconds | `0.5` (seconds) |
| 1.5 kilobytes | `1536` (bytes) |
| $0.002 | `0.002` (USD) |

The Grafana dashboard layer applies display scaling (e.g. `* 1000` to show ms).

### 1.5 Naming style

- lowercase `snake_case` only — no camelCase, no hyphens.
- Be descriptive and avoid abbreviations that are not universally understood
  (`tx` for transaction is acceptable; `ag` for agent is not).
- Verb-first for event counters is fine (`agent_runs_total`, not `total_agent_runs`).

---

## 2. Labelling conventions

### 2.1 Allowed label cardinality

Labels must have **bounded, low-cardinality values**.

| Limit | Guidance |
|-------|----------|
| Max labels per metric | 4 |
| Max unique values per label | ~20 in normal operation |
| Unbounded strings (user input, drug names) | **Forbidden** as label values — use a separate counter or sanitise to a fixed set |

> **Why?** High-cardinality labels (one time-series per unique user, drug name,
> or error message) cause Prometheus memory to grow unboundedly and make scrapes
> slow.  `pharmacy_unknown_drug_total{drug="..."}` is the one existing violation
> — see §3.

### 2.2 Standard label names

Use these names consistently across all metrics:

| Label | Meaning | Example values |
|-------|---------|---------------|
| `status` | Outcome of an operation | `success`, `error`, `timeout` |
| `result` | Synonym for `status` on Stellar counters (legacy — prefer `status` for new metrics) | `success`, `failure` |
| `type` | Payment or category variant | `x402`, `mpp`, `direct` |
| `tool` | Agent tool name | `compare_prices`, `check_interactions` |
| `kind` | Sub-type within a metric | `prompt`, `completion` |
| `reason` | Why a block / rejection occurred | `daily_limit`, `category_limit` |
| `model` | LLM model identifier | `llama3-70b-8192` |
| `category` | Spending category | `medications`, `bills` |

### 2.3 Do not use labels for

- Free-form user-supplied strings (drug names, addresses, error messages).
- High-cardinality identifiers (session IDs, request IDs, wallet addresses).
- Boolean flags — prefer two separate counters or a `status=active/inactive`
  label with a fixed two-value set.

---

## 3. Audit of existing metrics in `shared/metrics.ts`

The table below lists every metric, its current convention compliance, and any
deviations that need to be fixed.

| Metric | Type | Labels | Convention check | Deviation / action |
|--------|------|--------|------------------|--------------------|
| `agent_runs_total` | Counter | `status` | ✅ | — |
| `agent_tool_calls_total` | Counter | `tool`, `status` | ✅ | — |
| `payments_usdc_total` | Counter | `type` | ✅ | — |
| `x402_settlements_total` | Counter | — | ✅ | — |
| `stellar_tx_submitted_total` | Counter | `result` | ⚠️ | `result` label should be `status` for consistency; migrate in a follow-up |
| `policy_blocks_total` | Counter | `reason` | ✅ | — |
| `payment_rejected_total` | Counter | `reason` | ✅ | — |
| `agent_iteration_limit_total` | Counter | — | ✅ | — |
| `agent_llm_tokens_total` | Counter | `kind` | ✅ | — |
| `agent_llm_iteration_tokens` | Gauge | `kind` | ✅ | — |
| `agent_llm_context_usage_ratio` | Gauge | — | ✅ | — |
| `agent_spending_usd` | Gauge | `category` | ✅ | — |
| `agent_transactions_total` | Counter | `status` | ⚠️ | Overlaps with `agent_runs_total` and `stellar_tx_submitted_total`; alert `AgentTransactionRejectionRateSustained` documents the scope difference inline (agent-level outcomes vs. raw network submissions vs. in-process policy blocks) |
| `x402_tx_extraction_failed_total` | Counter | — | ✅ | — |
| `pharmacy_unknown_drug_total` | Counter | `drug` | ❌ | **High-cardinality label** — `drug` is a free-form user string; cap to a safe set or drop the label and use a separate low-cardinality label like `drug_known=false`. Alerts `PharmacyUnknownDrugRateHigh` and `PharmacyUnknownDrugCardinalityHigh` watch for elevated rates and cardinality growth. Track in issue. |
| `agent_llm_error_total` | Counter | — | ✅ | — |
| `agent_llm_latency_ms` | Histogram | `model` | ⚠️ | **Unit suffix violation** — must be `_seconds` not `_ms`; rename to `agent_llm_latency_seconds` in a follow-up. Converted from Gauge to Histogram in issue #1034; buckets cover 100 ms–30 s. Alert `AgentLlmLatencyHigh` uses `histogram_quantile(0.95, ...)`. |
| `stellar_fee_bumps_total` | Counter | — | ✅ | — |
| `stellar_tx_bad_seq_retries_total` | Counter | — | ✅ | — |
| `bill_audit_oversized_rejections_total` | Counter | — | ✅ | — |

### Queue metrics (in `shared/agent-queue.ts`)

| Metric | Type | Labels | Convention check | Deviation / action |
|--------|------|--------|------------------|--------------------|
| `agent_queue_depth` | Gauge | — | ✅ | — |
| `agent_waiting_jobs` | Gauge | — | ✅ | — |

### Summary of deviations to fix

| Priority | Metric | Issue |
|----------|--------|-------|
| High | `pharmacy_unknown_drug_total` | Unbounded `drug` label — cardinality risk (alerts now in place) |
| Medium | `agent_llm_latency_ms` | Wrong unit suffix (`_ms` → `_seconds`); converted to Histogram in #1034 |
| Low | `stellar_tx_submitted_total` | `result` label should be `status` for consistency |
| Low | `agent_transactions_total` | Scope overlap with other counters — needs clarification |

---

## 4. Checklist for adding a new metric

Before opening a PR that introduces a metric, verify each item:

- [ ] **Prefix** matches the subsystem table in §1.1.
- [ ] **Counter ends in `_total`** (§1.2).
- [ ] **Unit suffix** uses a base unit (`_seconds`, `_bytes`, `_usd`) if the
      metric measures a dimensioned quantity (§1.3 & §1.4).
- [ ] **Name is `snake_case`** with no camelCase or hyphens (§1.5).
- [ ] **Labels are low-cardinality** — max ~20 unique values per label in normal
      operation (§2.1).
- [ ] **No free-form user input in labels** (§2.3).
- [ ] **Label names** use the standard vocabulary in §2.2 where applicable.
- [ ] **Metric and each label have a `help` string** that explains what they
      measure.
- [ ] **Metric is registered on the shared `registry`** in `shared/metrics.ts`
      (never on the global default registry).
- [ ] **Added to [`docs/observability/metrics-catalog.md`](./metrics-catalog.md)**
      with type, labels, meaning, and which dashboard panel uses it.
- [ ] **Consider whether an alert rule in
      [`docker/prometheus/rules.yml`](../../docker/prometheus/rules.yml)
      is appropriate** for the new metric.
