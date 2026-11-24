# Local Monitoring (Grafana + Prometheus)

Local Grafana and Prometheus are provisioned via Docker Compose for debugging agent, API, and Stellar payment performance. See [README.md — Docker dev](../README.md#docker-dev-one-command) for boot instructions (`docker compose up`, Grafana at `http://localhost:3030` with `admin`/`admin`, Prometheus at `http://localhost:9090`).

## Provisioned Grafana Dashboards

Dashboards are file-provisioned from `docker/grafana/dashboards/` via `docker/grafana/provisioning/dashboards/careguard.yml` (`updateIntervalSeconds: 10`, `allowUiUpdates: true`, folder `""`, orgId `1`). Prometheus datasource is provisioned from `docker/grafana/provisioning/datasources/prometheus.yml` (UID `prometheus`, URL `http://prometheus:9090`).

| Dashboard | File | UID | Title |
|-----------|------|-----|-------|
| CareGuard Overview | `docker/grafana/dashboards/careguard.json` | `careguard-overview` | CareGuard Overview |
| CareGuard — Agent | `docker/grafana/dashboards/agent.json` | `careguard-agent` | CareGuard - Agent |
| CareGuard — Payments | `docker/grafana/dashboards/payments.json` | `careguard-payments` | CareGuard - Payments |

### CareGuard Overview (`careguard-overview`)

High-level health for the whole system (time range `now-1h` → `now`).

| Panel | Type | PromQL | What to expect locally |
|-------|------|--------|------------------------|
| Agent Runs | Stat | `agent_runs_total` | Counter of agent invocations; should increase when you trigger runs via the dashboard or `POST /agent/run`. Flat during idle is normal. |
| LLM Tokens (24h) | Stat | `agent_llm_tokens_24h{kind="prompt/completion"}` *legacy name — current canonical metric is `agent_llm_tokens_total{kind=…}` in `shared/metrics.ts`* | Prompt tokens ~3–5× completion tokens. |
| LLM Cost (USD) | Stat | `agent_llm_cost_usd` *not currently exported by `shared/metrics.ts`; see `agent_spending_usd` and `docs/observability/metrics-catalog.md`* | Track against local LLM budget. |
| Spending by Category | Stat | `agent_spending_usd{category="medications\|bills\|service_fees"}` | Medications largest; service fees near zero. |
| Agent Runs Success/Fail | Timeseries | `rate(agent_runs_total[5m])` | Steady rate matching request volume. |
| LLM Tokens per Day | Timeseries | `rate(agent_llm_tokens_total{kind="prompt\|completion"}[5m])` | Smooth curves; spikes indicate verbose output or retries. |
| Transaction Status | Timeseries | `rate(agent_transactions_total{status="completed\|pending\|rejected"}[5m])` | Completed dominates; rising rejected → policy/Stellar issue. |
| Stellar Transaction Success Rate | Stat | `rate(agent_stellar_tx_success_total[5m])` *canonical: `stellar_tx_submitted_total{result}`* | >95% expected. |
| Policy Blocks Over Time | Timeseries | `increase(agent_transactions_total{status="rejected"}[1h])` | Near zero; sustained blocks → policy too restrictive. |

### CareGuard — Agent (`careguard-agent`)

Agent runtime and LLM drill-down.

| Panel | Type | PromQL | What to expect locally |
|-------|------|--------|------------------------|
| Agent Runs | Stat | `agent_runs_total` | Same as overview. |
| Agent Runs Rate | Timeseries | `rate(agent_runs_total[5m])` | Use to verify agent activity during an incident window. |
| Agent Runs by Status | Pie | `agent_runs_total` by `status` | Mostly `success`; growing `error` slice → systemic failure. |
| Agent Iteration Limit Hits | Stat | `agent_iteration_limit_total` | Normally 0; non-zero → runaway LLM loop. |
| LLM Tokens (24h) | Stat | `agent_llm_tokens_total{kind="prompt\|completion"}` | See overview baseline. |
| LLM Tokens per Day | Timeseries | `rate(agent_llm_tokens_total{kind="prompt\|completion"}[5m])` | See overview. |
| LLM Context Usage Ratio | Gauge | `agent_llm_context_usage_ratio` | <0.8 healthy; approaching 1.0 → truncation risk. |
| LLM Latency | Timeseries | `agent_llm_latency_ms{model}` | 500ms–5s typical. |
| LLM Errors | Stat | `agent_llm_error_total` | Any increase → investigate provider/key. |
| Tool Calls by Tool | Timeseries | `rate(agent_tool_calls_total[5m])` by `tool` | Compare ratios to expected agent behaviour. |
| Policy Blocks | Timeseries | `increase(policy_blocks_total[1h])` by `reason` | Rising blocks → policy too aggressive. |

### CareGuard — Payments (`careguard-payments`)

Stellar payments, x402 settlements, and spending.

| Panel | Type | PromQL | What to expect locally |
|-------|------|--------|------------------------|
| USDC Payments Total | Stat | `payments_usdc_total{type}` | Increments per payment type. |
| Payment Rejections by Reason | Stat | `payment_rejected_total{reason}` | Near zero; frequent rejections → low limits/balance. |
| Spending by Category | Stat | `agent_spending_usd{category=…}` | Same as overview. |
| Transaction Status Breakdown | Timeseries | `rate(agent_transactions_total{status=…}[5m])` | See overview. |
| Transaction Volume by Status | Pie | `agent_transactions_total` by `status` | Same breakdown as timeseries. |
| Stellar Transactions Submitted | Stat | `stellar_tx_submitted_total{result}` | Count by result; small `bad_seq` is normal. |
| Stellar Transaction Rate | Timeseries | `rate(stellar_tx_submitted_total[5m])` by `result` | Same split over time. |
| Stellar Bad-Sequence Retries | Stat | `stellar_tx_bad_seq_retries_total` | Rising → sequence contention. |
| Fee-Bump Transactions | Stat | `stellar_fee_bumps_total` | Normally 0/low. |
| x402 Settlements | Stat | `x402_settlements_total` | Increments per x402 settlement. |
| x402 Extraction Failures | Stat | `x402_tx_extraction_failed_total` | Rising with settlements → protocol/facilitator mismatch. |

> **Canonical metric definitions** are in `shared/metrics.ts` and cataloged in `docs/observability/metrics-catalog.md`. Alerting thresholds are in `docker/prometheus/rules.yml` and SLI targets in `docs/observability/slo.md`. Some dashboard expressions predate the latest catalog (e.g. `agent_llm_tokens_24h` vs `agent_llm_tokens_total`) — prefer the catalog for the source of truth and update dashboards to the canonical name when you touch them.

## Key prom-client Metrics → Panel Map

| Metric (from `shared/metrics.ts` + `shared/agent-queue.ts`) | Type / Labels | Which panels show it |
|---|---|---|
| `agent_runs_total{status}` | Counter `status` | Overview: Agent Runs, Success/Fail; Agent: Runs, Runs Rate, Runs by Status |
| `agent_tool_calls_total{tool,status}` | Counter | Agent: Tool Calls by Tool |
| `agent_iteration_limit_total` | Counter | Agent: Iteration Limit Hits |
| `agent_llm_tokens_total{kind}` | Counter `prompt`/`completion` | Overview: LLM Tokens per Day; Agent: LLM Tokens (24h), Tokens per Day |
| `agent_llm_iteration_tokens{kind}` | Gauge | Agent drill-down (per-iteration) |
| `agent_llm_context_usage_ratio` | Gauge | Agent: LLM Context Usage Ratio (alerts at >0.9) |
| `agent_llm_error_total` | Counter | Agent: LLM Errors |
| `agent_llm_latency_ms{model}` | Gauge | Agent: LLM Latency |
| `agent_spending_usd{category}` | Gauge `medications`/`bills`/`service_fees` | Overview & Payments: Spending by Category; Overview: LLM Cost (via spending) |
| `agent_transactions_total{status}` | Counter | Overview: Transaction Status, Policy Blocks Over Time; Payments: Transaction Status Breakdown, Volume by Status |
| `payments_usdc_total{type}` | Counter | Payments: USDC Payments Total |
| `x402_settlements_total` | Counter | Payments: x402 Settlements |
| `x402_tx_extraction_failed_total` | Counter | Payments: x402 Extraction Failures |
| `stellar_tx_submitted_total{result}` | Counter | Payments: Stellar Transactions Submitted, Transaction Rate |
| `stellar_fee_bumps_total` | Counter | Payments: Fee-Bump Transactions |
| `stellar_tx_bad_seq_retries_total` | Counter | Payments: Stellar Bad-Sequence Retries |
| `policy_blocks_total{reason}` | Counter | Agent: Policy Blocks; Overview: Policy Blocks |
| `payment_rejected_total{reason}` | Counter | Payments: Payment Rejections by Reason |
| `pharmacy_unknown_drug_total{drug}` | Counter | Not paneled; see `metrics-catalog.md` Known gaps (cardinality risk) |
| `bill_audit_oversized_rejections_total` | Counter | Not paneled; guardrail visibility |
| `agent_queue_depth` | Gauge | Alerting only (`AgentQueueDepthHigh`) — add a panel if you need local queue debugging |
| `agent_waiting_jobs` | Gauge | Alerting only (`AgentQueueSaturated`) |
| Node default metrics (`process_*`, `nodejs_*`, `prometheus_*`) | Gauges/Counters | Not in committed dashboards — add ad-hoc panels for heap/event-loop/GC when debugging leaks or stalls |

Recording rules pre-aggregating SLI burn-rate series (`careguard:<sli>:<kind>_rate<window>`) live in `docker/prometheus/recording-rules.yml`; see `docs/observability/slo.md`.

## Running and Verifying Locally

```bash
cp .env.example .env   # ensure OZ_FACILITATOR_API_KEY, AGENT_SECRET_KEY, etc.
docker compose up -d   # or docker compose up for foreground logs
# Verify
curl -s http://localhost:3004/metrics | head      # raw Prometheus exposition
curl -s http://localhost:9090/-/ready             # Prometheus ready
curl -s http://localhost:3030/api/health          # Grafana healthy
# Open UIs
# Prometheus: http://localhost:9090  (query e.g. rate(agent_runs_total[5m]))
# Grafana:    http://localhost:3030  (admin / admin)
docker compose down -v   # tear down and drop volumes (spending log, redis, Grafana)
```

Prometheus scrapes `server:3004/metrics` every `5s` (`docker/prometheus/prometheus.yml`, `scrape_interval: 5s`). If Grafana shows “No data”, check `docker compose logs server` and `docker compose logs prometheus`.

## Adding a New Dashboard or Panel Locally

Provisioning is file-based — any JSON under `docker/grafana/dashboards/` is loaded automatically. To avoid accidentally committing experimental panels:

1. **Prefer ephemeral UI edits for exploration.** Grafana provisioning has `allowUiUpdates: true`, so you can edit dashboards in the UI at `http://localhost:3030` without touching committed JSON. Those edits live in the `grafana-data` volume (`docker compose volume` `grafana-data`) and disappear after `docker compose down -v`. They are *not* persisted to `docker/grafana/dashboards/*.json` until you explicitly export.

2. **When you want to keep a change**, export it deliberately:
   - In Grafana: Dashboard → Share → Export → Save to file → overwrite the corresponding `docker/grafana/dashboards/<name>.json` (or create `docker/grafana/dashboards/my-feature.json` with a new `uid` and `title`).
   - Validate JSON: `jq empty docker/grafana/dashboards/my-feature.json`
   - Confirm provisioning still loads: wait ~10s (`updateIntervalSeconds: 10`) or `docker compose restart grafana`, then check `docker compose logs grafana` for `provisioning dashboards` errors.

3. **Keep local-only experiments out of git.** Options:
   - Do not `git add` the new file; or
   - Keep the file in a sibling directory (e.g. `docker/grafana/dashboards.local/` which is `.gitignore`-d — if you want this, add `docker/grafana/dashboards.local/` to `.gitignore` and mount it separately in a local `docker-compose.override.yml`):
     ```yaml
     # docker-compose.override.yml (local-only, ignored by git if you .gitignore-override it)
     services:
       grafana:
         volumes:
           - ./docker/grafana/dashboards.local:/etc/grafana/provisioning/dashboards-local:ro
     ```
     Then add a second provisioning provider pointing at that path, or simply copy the file into the committed dir only when ready.

4. **Panel authoring checklist:**
   - Set `datasource.uid` to `prometheus` (the UID in `docker/grafana/provisioning/datasources/prometheus.yml`). Panels with a different UID will show “Data source not found” after restart.
   - Prefer canonical metric names from `shared/metrics.ts` / `docs/observability/metrics-catalog.md`. If you introduce a new metric, register it in `shared/metrics.ts`, add it to `metrics-catalog.md`, and follow `docs/observability/metrics-naming.md` (prefix, `_total` suffix, label cardinality).
   - Use recording-rule series (`careguard:…_rate…`) for SLI/error-budget panels so queries stay cheap — see `docker/prometheus/recording-rules.yml`.
   - Run `promtool check rules docker/prometheus/recording-rules.yml` after adding recording rules.
   - Keep `uid` unique (e.g. `careguard-my-feature`) and `title` descriptive. Do not reuse an existing UID.
   - Include `schemaVersion` and dashboard `tags: ["careguard"]` for consistency.

5. **Before committing**, review the diff:
   ```bash
   git diff docker/grafana/dashboards/
   git diff docker/grafana/provisioning/
   ```
   Only dashboards/datasources intended for shared local dev should be committed. Remove API keys, contact points, or alert notification channels you tested locally.

6. **Prometheus rule changes** (`docker/prometheus/rules.yml`) follow the same principle: validate with `promtool check rules docker/prometheus/rules.yml` and `promtool check config docker/prometheus/prometheus.yml`, then restart `prometheus` or wait for the `evaluation_interval: 5s` reload.

See also `docs/observability/dashboard-guide.md` for panel-level rationale and `docs/observability/metrics-catalog.md` for the full metric registry.
