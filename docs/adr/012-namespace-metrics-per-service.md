# ADR-012: Namespace or Scope Shared Metrics Registry Per Service

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [#1448](https://github.com/harystyleseze/careguard/issues/1448)

## Context

`shared/metrics.ts` exports a single custom `Registry` instance used by every server entrypoint. The registry exists as a custom instance (not the global default) specifically to dodge a `vm.Module` double-instantiation problem noted in the source comment. All counters and gauges in `shared/metrics.ts` explicitly pass `registers: [registry]` to register on this custom registry.

However, two other shared modules register metrics on the **global default registry** instead:

- `shared/agent-queue.ts`: `agent_queue_depth` (Gauge), `agent_waiting_jobs` (Gauge)
- `shared/rate-limit.ts`: `ratelimit_hits_total` (Counter), `route_concurrent_requests` (Gauge)

These four metrics do NOT pass `registers: [registry]`, so they register on `prom-client`'s global default registry. The `registry.metrics()` handler in `shared/metrics.ts` (which serves `/metrics`) will NOT include them — meaning Prometheus is missing 4 metrics from scraping.

### Complete Metric Name Inventory

**On custom registry (`shared/metrics.ts`):**

| Metric | Type | Labels |
|--------|------|--------|
| `agent_runs_total` | Counter | `status` |
| `agent_tool_calls_total` | Counter | `tool`, `status` |
| `payments_usdc_total` | Counter | `type` |
| `x402_settlements_total` | Counter | — |
| `stellar_tx_submitted_total` | Counter | `result` |
| `policy_blocks_total` | Counter | `reason` |
| `payment_rejected_total` | Counter | `reason` |
| `agent_iteration_limit_total` | Counter | — |
| `agent_llm_tokens_total` | Counter | `kind` |
| `agent_llm_iteration_tokens` | Gauge | `kind` |
| `agent_llm_context_usage_ratio` | Gauge | — |
| `agent_spending_usd` | Gauge | `category` |
| `agent_transactions_total` | Counter | `status` |
| `x402_tx_extraction_failed_total` | Counter | — |
| `pharmacy_unknown_drug_total` | Counter | `drug` |
| `agent_llm_error_total` | Counter | — |
| `agent_llm_latency_ms` | Gauge | `model` |
| `stellar_fee_bumps_total` | Counter | — |
| `stellar_tx_bad_seq_retries_total` | Counter | — |
| `bill_audit_oversized_rejections_total` | Counter | — |

**On global default registry (leaked):**

| Metric | Type | Labels | Source |
|--------|------|--------|--------|
| `ratelimit_hits_total` | Counter | `policy` | `shared/rate-limit.ts` |
| `route_concurrent_requests` | Gauge | `route` | `shared/rate-limit.ts` |
| `agent_queue_depth` | Gauge | — | `shared/agent-queue.ts` |
| `agent_waiting_jobs` | Gauge | — | `shared/agent-queue.ts` |

### Naming Collision Risk

Because all servers share one custom registry and one global registry, metric names must be globally unique. Currently there are 20 metrics on the custom registry and 4 on the global registry. With no enforced namespacing, two services could silently collide on a metric name and corrupt each other's `/metrics` output. For example, if `pharmacy-api` and `bill-audit-api` both registered a `request_duration_ms` counter, they would appear as a single metric in Prometheus.

## Decision

Propose a **per-service metric prefix convention** enforced at registration time, combined with fixing the leaked metrics on the global registry.

### Part 1: Fix Leaked Metrics

Move the four metrics currently on the global default registry to the custom registry:

- `shared/agent-queue.ts`: Add `registers: [registry]` to both `agentQueueDepth` and `agentWaitingJobs`. Import `registry` from `shared/metrics.ts`.
- `shared/rate-limit.ts`: Add `registers: [registry]` to both `rateLimitHitsTotal` and `routeConcurrentRequests`. Import `registry` from `shared/metrics.ts`.

This ensures all metrics are served by the `/metrics` endpoint.

### Part 2: Per-Service Prefix Convention

Define a `MetricsCollector` class that wraps `prom-client` counters/gauges with a service prefix:

```ts
class MetricsCollector {
  constructor(private serviceName: string, private registry: Registry) {}

  /** Create a prefixed counter: `{serviceName}_{name}` */
  counter(name: string, help: string, labelNames?: string[]): Counter {
    return new Counter({
      name: `${this.serviceName}_${name}`,
      help,
      labelNames,
      registers: [this.registry],
    });
  }

  /** Create a prefixed gauge: `{serviceName}_{name}` */
  gauge(name: string, help: string, labelNames?: string[]): Gauge {
    return new Gauge({
      name: `${this.serviceName}_${name}`,
      help,
      labelNames,
      registers: [this.registry],
    });
  }

  /** Validate that a metric name doesn't collide with existing names */
  validateName(name: string): void {
    const fullName = `${this.serviceName}_${name}`;
    // Check against registered metrics at startup
  }
}
```

### Naming Convention

| Current Name | Prefixed Name | Service |
|---|---|---|
| `agent_runs_total` | `agent_runs_total` | (already agent-prefixed) |
| `agent_tool_calls_total` | `agent_tool_calls_total` | (already agent-prefixed) |
| `payments_usdc_total` | `agent_payments_usdc_total` | agent |
| `stellar_tx_submitted_total` | `agent_stellar_tx_submitted_total` | agent |
| `ratelimit_hits_total` | `shared_ratelimit_hits_total` | shared |
| `agent_queue_depth` | `shared_agent_queue_depth` | shared |
| `pharmacy_unknown_drug_total` | `pharmacy_unknown_drug_total` | (already pharmacy-prefixed) |
| `bill_audit_oversized_rejections_total` | `bill_audit_oversized_rejections_total` | (already bill-audit-prefixed) |

Existing metrics that already have a service-like prefix (`agent_*`, `pharmacy_*`, `bill_audit_*`) keep their current names. Only unprefixed metrics get a `shared_` prefix since they come from shared modules used by all services.

### Part 3: Validation at Registration

Add a startup check that scans all registered metric names and logs a warning if any two metrics share the same name. This catches collisions early rather than at Prometheus scrape time:

```ts
function checkMetricCollisions(registry: Registry): void {
  const metrics = registry.getMetricsAsJSON();
  const names = metrics.map(m => m.name);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      logger.warn('Duplicate metric name detected', { name });
    }
    seen.add(name);
  }
}
```

### Migration Plan

1. **Phase 1 — Fix leaked metrics**: Move the 4 metrics from the global registry to the custom registry. This is a one-line change per metric (`registers: [registry]`). No metric names change.

2. **Phase 2 — Add `MetricsCollector` class**: Create `shared/metrics-collector.ts` with the prefix-enforcing wrapper. Add the collision check at startup.

3. **Phase 3 — Audit existing names**: Rename any unprefixed metrics that could collide. The current 20 custom-registry metrics are already named distinctly — no renames needed today.

4. **Phase 4 — Adopt `MetricsCollector` for new metrics**: New metrics must use `MetricsCollector` instead of raw `new Counter()`/`new Gauge()`. Existing metrics can be migrated opportunistically.

### Grafana Dashboard Impact

Renaming metrics breaks existing Grafana dashboard queries. The migration plan avoids renaming existing metrics — it only:
1. Moves 4 metrics from the global registry to the custom registry (no name change)
2. Adds prefixes to new metrics going forward

Existing Grafana dashboards will see no breakage. The 4 previously-missing metrics (`ratelimit_hits_total`, `route_concurrent_requests`, `agent_queue_depth`, `agent_waiting_jobs`) will now appear in `/metrics`, which is a pure addition.

### Prometheus Scrape Config

No changes needed. The `/metrics` endpoint already serves from the custom registry. Once the 4 leaked metrics are moved to the custom registry, they will automatically appear in the scrape output. Prometheus will pick them up on the next scrape interval.

## Consequences

### Positive
- Eliminates the risk of silent metric-name collisions between services
- Fixes 4 metrics that are currently invisible to Prometheus scraping
- Provides a validation mechanism that catches duplicates at startup
- Existing Grafana dashboards are unaffected (no renames)

### Negative
- Slightly more verbose metric names with prefixes
- Adds a `MetricsCollector` wrapper that adds indirection
- The `validateName()` check adds a small amount of startup overhead

### Risks
- Moving metrics from the global registry to the custom registry could affect any code that reads from the global registry. Mitigated by auditing all `prom-client` usage — only `shared/metrics.ts`, `shared/rate-limit.ts`, and `shared/agent-queue.ts` register metrics.
- The prefix convention is a convention, not enforced at the type level. Mitigated by the startup collision check.

## Compliance

- All new metrics must use `MetricsCollector` with a service prefix
- All metrics must register on the custom registry from `shared/metrics.ts` — registering on the global default registry is forbidden
- The collision check must run at startup for every server entrypoint
- Renaming existing metrics requires a separate ADR with Grafana migration plan
