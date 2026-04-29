# CareGuard Observability

## Metrics overview

All metrics are emitted by `shared/metrics.ts` — a lightweight in-memory registry with Prometheus-compatible text output. No external dependency (e.g. `prom-client`) is required.

The agent server exposes metrics at `GET /metrics`.

---

## Stellar transaction metrics (issue #104)

### Counters

| Metric | Labels | Description |
|---|---|---|
| `stellar_tx_submitted_total` | `kind` | Every call to Horizon `submitTransaction` |
| `stellar_tx_result_total` | `kind`, `result` | Outcome of each submission |

**`kind` values**

| Value | Source |
|---|---|
| `usdc_transfer` | `payBill` in `agent/tools.ts` |
| `mpp_charge` | `payForMedication` in `agent/tools.ts` |
| `change_trust` | `addUsdcTrustline` in `scripts/setup-wallets.ts` |

**`result` values**

The `result` label is the Horizon `result_codes.transaction` string on failure, or `"success"` on success. Common values:

| Value | Meaning |
|---|---|
| `success` | Transaction confirmed |
| `tx_bad_seq` | Sequence number mismatch — retry after reloading account |
| `tx_failed` | At least one operation failed |
| `tx_insufficient_fee` | Base fee too low |
| `unknown` | Network timeout or unparseable error |

### Histogram

| Metric | Labels | Buckets (ms) | Description |
|---|---|---|---|
| `stellar_submit_latency_ms` | `kind` | 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000 | Round-trip time from submit to Horizon response |

### Alerting rule

Page when the success rate drops below 95 % over a 5-minute window:

```yaml
# Prometheus alerting rule (add to your rules file)
groups:
  - name: careguard_stellar
    rules:
      - alert: StellarSuccessRateLow
        expr: |
          (
            sum(rate(stellar_tx_result_total{result="success"}[5m]))
            /
            sum(rate(stellar_tx_submitted_total[5m]))
          ) < 0.95
        for: 5m
        labels:
          severity: page
        annotations:
          summary: "Stellar transaction success rate below 95%"
          description: >
            The Horizon facilitator or OZ gateway may be degraded.
            Check Horizon status at https://status.stellar.org and
            verify OZ_FACILITATOR_API_KEY is valid.
```

---

## Per-tool latency + USDC cost metrics (issue #102)

### Histogram

| Metric | Labels | Description |
|---|---|---|
| `agent_tool_latency_ms` | `tool` | End-to-end duration of each LLM tool call |

### Counter

| Metric | Labels | Description |
|---|---|---|
| `agent_tool_cost_usdc_calls` | `tool` | Number of tool calls that incurred an x402 service fee |
| `agent_tool_cost_usdc_total` | `tool` | Cumulative USDC spent on x402 per tool (gauge in `/metrics`) |

**Known `tool` values and their x402 costs**

| Tool | x402 cost (USDC) |
|---|---|
| `compare_pharmacy_prices` | 0.002 |
| `audit_medical_bill` | 0.01 |
| `fetch_and_audit_bill` | 0 (delegates to `audit_medical_bill`) |
| `check_drug_interactions` | 0.001 |
| `pay_for_medication` | 0 (MPP charge, not service fee) |
| `pay_bill` | 0 (direct transfer, not service fee) |

### REST summary endpoint

```
GET /agent/metrics/summary?since=<ISO8601>
```

Returns per-tool totals and an aggregate for the dashboard.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `since` | ISO 8601 string | Only count tool calls after this timestamp. Omit for all-time totals. |

**Response schema**

```json
{
  "since": "2026-04-22T00:00:00.000Z",
  "toolMetrics": {
    "compare_pharmacy_prices": {
      "calls": 5,
      "totalLatencyMs": 1230,
      "avgLatencyMs": 246.0,
      "totalCostUsdc": 0.010000
    }
  },
  "summary": {
    "totalToolCalls": 12,
    "totalCostUsdc": 0.033000
  }
}
```

`totalCostUsdc` in `summary` is computed from the spending tracker's `service_fee` transactions in the requested time window — it is the ground truth for USDC actually spent via x402.

### Dashboard — Settings tab

The Settings tab fetches `/agent/metrics/summary?since=<7 days ago>` on mount and displays:

> Last 7 days: **12** tool calls, **$0.0330** USDC spent on x402

---

## Local development

Run the server and inspect metrics:

```bash
# Start the unified server
npm run dev

# In another terminal, poll Prometheus-format metrics
curl http://localhost:3004/metrics

# Or fetch the JSON summary
curl "http://localhost:3004/agent/metrics/summary?since=$(date -u -v-7d '+%Y-%m-%dT%H:%M:%SZ')"
```

Docker Compose (issue #111) exposes Prometheus on `:9090` and Grafana on `:3000`. The pre-built dashboard (`docker/grafana/dashboards/careguard.json`) includes panels for Stellar success rate and per-tool USDC cost.
