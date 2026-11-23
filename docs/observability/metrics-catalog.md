# Metrics Catalog

Every metric exported by CareGuard, what it means, and where it's used. All metrics
are registered on the shared `prom-client` `Registry` in [`shared/metrics.ts`](../../shared/metrics.ts)
(queue gauges live in [`shared/agent-queue.ts`](../../shared/agent-queue.ts)) and served at `/metrics`.
See the [Grafana dashboard guide](./dashboard-guide.md) for how these are visualized.

> **Before adding a metric:** read the [metrics naming and labelling conventions](./metrics-naming.md)
> for prefix rules, `_total` suffix, base-unit policy, and label-cardinality limits.
> Add every new metric to this catalog and run through the checklist in that guide.

## Agent

| Metric | Type | Labels | Meaning | Used by |
|---|---|---|---|---|
| `agent_runs_total` | Counter | `status` | Total agent run attempts, by outcome. | Overview dashboard "Agent Runs" panel |
| `agent_tool_calls_total` | Counter | `tool`, `status` | Total tool invocations made by the agent, by tool name and outcome. | Agent dashboard |
| `agent_iteration_limit_total` | Counter | — | Total agent runs that hit the iteration limit before completing. | Agent dashboard / alerting on runaway loops |
| `agent_llm_tokens_total` | Counter | `kind` (`prompt`/`completion`) | Cumulative LLM tokens consumed. | Overview dashboard "LLM Tokens (24h)" |
| `agent_llm_iteration_tokens` | Gauge | `kind` | Tokens consumed in the most recent agent iteration. | Agent dashboard, per-run drill-down |
| `agent_llm_context_usage_ratio` | Gauge | — | Latest iteration's token usage as a fraction of the model's context window. | Agent dashboard; alerts near context exhaustion |
| `agent_llm_error_total` | Counter | — | Total LLM API errors during agent runs. | Agent dashboard error-rate panel |
| `agent_llm_latency_ms` | Histogram | `model` | LLM API call latency distribution (ms). Buckets: 100, 250, 500, 1k, 2k, 5k, 10k, 20k, 30k. | Agent dashboard latency panel; `AgentLlmLatencyHigh` alert |
| `agent_spending_usd` | Gauge | `category` | Running USD spend, broken out by category. | Overview dashboard "LLM Cost (USD)", `AgentSpendingBudgetOverrun` alert |
| `agent_transactions_total` | Counter | `status` | Total agent-initiated transactions, by outcome (`completed`/`pending`/`rejected`). | Agent dashboard "Transaction Status" panel; `AgentTransactionRejectionRateSustained` alert |

## Payments / Stellar

| Metric | Type | Labels | Meaning | Used by |
|---|---|---|---|---|
| `payments_usdc_total` | Counter | `type` | Total USDC payments made, by payment type. | Payments dashboard |
| `x402_settlements_total` | Counter | — | Total x402 protocol settlements. | Payments dashboard |
| `x402_tx_extraction_failed_total` | Counter | — | Total failures extracting a tx reference from an x402 payment response header. | Payments dashboard error panel; flags receipt-parsing regressions |
| `stellar_tx_submitted_total` | Counter | `result` | Total Stellar transactions submitted, by result (success/failure). | Payments dashboard |
| `stellar_fee_bumps_total` | Counter | — | Total fee-bump transactions submitted to accelerate a stuck tx. | Payments dashboard |
| `stellar_tx_bad_seq_retries_total` | Counter | — | Total retries triggered by a `tx_bad_seq` response from Horizon. | Payments dashboard; indicates sequence-number contention |
| `policy_blocks_total` | Counter | `reason` | Total spending-policy blocks, by reason. | Payments dashboard "Policy Blocks" panel |
| `payment_rejected_total` | Counter | `reason` | Total payments rejected by spending policy, by reason. | Payments dashboard |

## Pharmacy

| Metric | Type | Labels | Meaning | Used by |
|---|---|---|---|---|
| `pharmacy_unknown_drug_total` | Counter | `drug` | Total price lookups for a drug not in the catalog. | Pharmacy panel; `PharmacyUnknownDrugRateHigh` and `PharmacyUnknownDrugCardinalityHigh` alerts |
| `bill_audit_oversized_rejections_total` | Counter | — | Total bill-audit requests rejected for exceeding `BILL_AUDIT_MAX_ITEMS`. | Pharmacy panel; input-size guardrail visibility |

## Agent Queue

| Metric | Type | Labels | Meaning | Used by |
|---|---|---|---|---|
| `agent_queue_depth` | Gauge | — | Number of agent runs currently executing. | Overview dashboard concurrency panel |
| `agent_waiting_jobs` | Gauge | — | Number of agent requests currently waiting in the queue. | Overview dashboard; queue-backup alerting |

## Default Node process metrics

`collectDefaultMetrics({ register: registry })` in `shared/metrics.ts` also exports the
standard `prom-client` Node.js process metrics (event-loop lag, heap usage, active
handles/requests, GC duration, process CPU/uptime). These aren't CareGuard-specific
but are useful for spotting memory leaks, event-loop stalls, or GC pressure ahead of
symptoms showing up in the app-level metrics above.

## Known gaps

- `agent_tool_calls_total`, `stellar_tx_submitted_total`, and `payment_rejected_total`
  have no label for which *user/session* triggered them — useful for aggregate rates,
  but you cannot currently attribute a spike to a specific caller from these metrics
  alone.
- `agent_llm_iteration_tokens` is a Gauge tracking only the *latest* observation,
  not a distribution — there's no histogram/percentile view of token usage over
  time. (`agent_llm_latency_ms` was also a Gauge but has been converted to a
  Histogram — see the metric entry above.)
- `pharmacy_unknown_drug_total`'s `drug` label is unbounded (any string a client
  sends), which is a cardinality risk if abused. The `PharmacyUnknownDrugRateHigh`
  and `PharmacyUnknownDrugCardinalityHigh` alerts in `docker/prometheus/rules.yml`
  watch for elevated lookup rates and label-cardinality growth respectively.
