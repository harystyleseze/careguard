# Grafana Dashboard Guide

## Accessing Grafana

Grafana is provisioned via Docker Compose. Start it with:

```bash
docker compose up -d grafana
```

Access the web UI at `http://localhost:3000` (default credentials: `admin` / `admin`).

Dashboards are loaded automatically from `docker/grafana/dashboards/` via the provisioning provider defined in `docker/grafana/provisioning/dashboards/careguard.yml`. The Prometheus datasource is configured in `docker/grafana/provisioning/datasources/prometheus.yml` and targets `http://prometheus:9090`.

All metrics are defined in `shared/metrics.ts` using a custom prom-client `Registry`.

---

## Dashboard: CareGuard Overview (`careguard-overview`)

The combined overview dashboard showing high-level health of the entire system.

### Agent Runs
- **Metric:** `agent_runs_total`
- **Type:** Stat (total count)
- **Baseline:** Increases with each agent invocation. Expect steady growth proportional to request volume.
- **Anomaly:** A flat line during business hours suggests the agent is not processing requests. A sudden spike may indicate a loop or retry storm.

### LLM Tokens (24h)
- **Metrics:** `agent_llm_tokens_total{kind="prompt"}`, `agent_llm_tokens_total{kind="completion"}`
- **Type:** Stat
- **Baseline:** Prompt tokens are typically 3–5× completion tokens for conversation-style runs.
- **Anomaly:** Excessively high completion tokens may indicate the model is producing verbose or repetitive output. See [agent runbook](../runbooks/README.md).

### LLM Cost (USD)
- **Metric:** `agent_llm_cost_usd`
- **Type:** Stat
- **Baseline:** Varies with model and token count. Track against your monthly LLM budget.
- **Anomaly:** A sudden cost jump without increased request volume suggests a configuration issue or runaway agent loop.

### Spending by Category
- **Metric:** `agent_spending_usd{category="medications|bills|service_fees"}`
- **Type:** Stat
- **Baseline:** Medications should be the largest category. Service fees should be minimal.
- **Anomaly:** Spike in service fees may indicate an unexpected charge or misconfigured fee schedule.

### Agent Runs Success/Fail
- **Metric:** `rate(agent_runs_total[5m])`
- **Type:** Timeseries
- **Baseline:** Steady rate matching user request volume.
- **Anomaly:** Zero rate indicates no agent activity. Spikes with error labels suggest failures.

### LLM Tokens per Day
- **Metrics:** `rate(agent_llm_tokens_total{kind="prompt|completion"}[5m])`
- **Type:** Timeseries
- **Baseline:** Smooth curves following daily usage patterns.
- **Anomaly:** Sharp drops or spikes may indicate network issues or a misconfigured model.

### Transaction Status
- **Metrics:** `rate(agent_transactions_total{status="completed|pending|rejected"}[5m])`
- **Type:** Timeseries
- **Baseline:** Completed should dominate. Rejected should be near zero.
- **Anomaly:** Rising rejected rate indicates spending policy blocks or Stellar network issues. See [runbook: wallet low](../runbooks/wallet-low.md).

### Stellar Transaction Success Rate
- **Metric:** `rate(agent_stellar_tx_success_total[5m])`
- **Type:** Stat
- **Baseline:** Should be >95%.
- **Anomaly:** Drop below 90% indicates Stellar network congestion or incorrect account sequencing.

### Policy Blocks Over Time
- **Metric:** `increase(agent_transactions_total{status="rejected"}[1h])`
- **Type:** Timeseries
- **Baseline:** Near zero under normal operation.
- **Anomaly:** Sustained blocks indicate the spending policy may be too restrictive. See [runbook: tune-audit-thresholds](../runbooks/tune-audit-thresholds.md).

---

## Dashboard: CareGuard - Agent (`careguard-agent`)

Per-service dashboard focused on the AI agent runtime and LLM interactions.

### Agent Runs (Stat)
See CareGuard Overview above.

### Agent Runs Rate (Timeseries)
- **Metric:** `rate(agent_runs_total[5m])`
- **Use during incidents:** Check if agent invocations dropped off during an incident window.

### Agent Runs by Status (Pie Chart)
- **Metric:** `agent_runs_total` (by `status` label)
- **Baseline:** Most runs should be `success`. A significant `error` slice indicates systemic failures.
- **Anomaly:** Growing error percentage. See [agent testing docs](../agent/testing.md).

### Agent Iteration Limit Hits
- **Metric:** `agent_iteration_limit_total`
- **Anomaly:** Non-zero values indicate agent runs that hit the max iteration ceiling. Review the agent prompt or increase the limit. See [agent policy docs](../agent/policy.md).

### LLM Tokens (24h) / LLM Tokens per Day
See CareGuard Overview above.

### LLM Context Usage Ratio
- **Metric:** `agent_llm_context_usage_ratio`
- **Type:** Gauge (0–1)
- **Baseline:** Should stay below 0.8 to leave room for tool responses.
- **Anomaly:** Values approaching 1.0 indicate the context window is nearly full, risking truncation or degraded quality.

### LLM Latency
- **Metric:** `agent_llm_latency_ms{model}`
- **Baseline:** Typically 500ms–5s depending on model and input size.
- **Anomaly:** Sustained high latency may indicate LLM provider throttling or network issues.

### LLM Errors
- **Metric:** `agent_llm_error_total`
- **Anomaly:** Any error count increase should be investigated immediately. See [runbook: leaked-secret](../runbooks/leaked-secret.md) if errors coincide with auth failures.

### Tool Calls by Tool
- **Metric:** `rate(agent_tool_calls_total[5m])` (by `tool` label)
- **Baseline:** Compare tool usage ratios to expected agent behaviour.
- **Anomaly:** A tool being called excessively may indicate an agent loop.

### Policy Blocks
- **Metric:** `increase(policy_blocks_total[1h])` (by `reason` label)
- **Anomaly:** Rising blocks suggest spending policy is too aggressive. See [runbook: tune-audit-thresholds](../runbooks/tune-audit-thresholds.md).

---

## Dashboard: CareGuard - Payments (`careguard-payments`)

Per-service dashboard focused on Stellar payments, x402 settlements, and transaction health.

### USDC Payments Total
- **Metric:** `payments_usdc_total{type}`
- **Baseline:** Increases with each payment type (medication, bill, service_fee).
- **Anomaly:** Payments for unrecognised types indicate a misconfiguration.

### Payment Rejections by Reason
- **Metric:** `payment_rejected_total{reason}`
- **Anomaly:** Frequent rejections suggest spending policy limits are too low or account balances are insufficient. See [runbook: wallet-low](../runbooks/wallet-low.md).

### Spending by Category
See CareGuard Overview above.

### Transaction Status Breakdown / Volume by Status
- **Metrics:** `rate(agent_transactions_total[5m])` and cumulative by `status` label.
- **Anomaly:** Rising `rejected` or `blocked` share. See [runbook: tune-audit-thresholds](../runbooks/tune-audit-thresholds.md).

### Stellar Transactions Submitted / Rate
- **Metric:** `stellar_tx_submitted_total{result}`
- **Baseline:** Most transactions should be `success`. A small `bad_seq` rate is normal.
- **Anomaly:** High `bad_seq` rate indicates sequence number drift. See [runbook: wallet-low](../runbooks/wallet-low.md).

### Stellar Bad-Sequence Retries
- **Metric:** `stellar_tx_bad_seq_retries_total`
- **Anomaly:** Rising retries indicate persistent sequence conflicts. May require manual sequence reset.

### Fee-Bump Transactions
- **Metric:** `stellar_fee_bumps_total`
- **Baseline:** Low/zero unless using Sponsored Reserves or account abstraction.

### x402 Settlements / Extraction Failures
- **Metrics:** `x402_settlements_total`, `x402_tx_extraction_failed_total`
- **Anomaly:** Extraction failures rising alongside settlement counts indicates a protocol mismatch or facilitator issue. See [x402 facilitator runbook](../runbooks/x402-facilitator-down.md).

---

## Provisioning Model

Dashboards are JSON files in `docker/grafana/dashboards/` loaded by a file-based provisioning provider:

```yaml
# docker/grafana/provisioning/dashboards/careguard.yml
apiVersion: 1
providers:
  - name: CareGuard
    orgId: 1
    folder: ""
    type: file
    updateIntervalSeconds: 10
    allowUiUpdates: true
    path: /etc/grafana/provisioning/dashboards
```

To add a new dashboard:
1. Create a new JSON file in `docker/grafana/dashboards/`
2. Restart Grafana or wait for the provisioning interval (10s)
3. The dashboard appears automatically in the Grafana UI

> **Note:** The datasource UID must match the Prometheus datasource configured in `docker/grafana/provisioning/datasources/prometheus.yml`. Current UID: `prometheus`.
