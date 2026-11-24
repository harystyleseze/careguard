# Load testing

The load scripts use [k6](https://grafana.com/docs/k6/latest/) and are not run
by Node.js. Install k6 separately before using the npm scripts.

## Install k6

- **macOS:** `brew install k6`
- **Windows:** `winget install k6 --source winget`
- **Debian/Ubuntu:** follow the official apt repository instructions at
  [grafana.com/docs/k6/latest/set-up/install-k6](https://grafana.com/docs/k6/latest/set-up/install-k6/),
  then run `sudo apt-get install k6`.
- **Docker:** `docker run --rm -i grafana/k6 run - < load/agent-run.js`

Verify the installation with `k6 version`.

## Agent load test

`npm run load` runs `load/agent-run.js` against the agent server. Start the
server first with `npm run agent`; it listens on `http://localhost:3004` by
default. The agent must have its normal local dependencies configured, including
an LLM endpoint such as `LLM_BASE_URL` pointing at a reachable mock or service.
At minimum, the agent startup requires `LLM_API_KEY`, `AGENT_SECRET_KEY`, and
`CAREGIVER_TOKEN`; `LLM_BASE_URL` and `LLM_MODEL` may select the provider and
model. For deterministic local runs, point `LLM_BASE_URL` at a compatible mock.

Set these variables when the defaults do not apply:

```sh
BASE_URL=http://localhost:3004 \
CAREGIVER_TOKEN=dev-caregiver-token \
npm run load
```

`BASE_URL` defaults to `http://localhost:3004`. `CAREGIVER_TOKEN` is consumed by
the agent server when it starts; set it to the same value used by that server.
The k6 script itself exercises `/agent/run` and `/agent/spending` without adding
an authorization header, so use the local test configuration expected by the
running agent.

## Bill-audit load test

`npm run load:bill-audit` runs `load/bill-audit.js` against the bill-audit
service. Start it with `npm run bill-audit-api`; it listens on
`http://localhost:3002` by default.

```sh
BASE_URL=http://localhost:3002 npm run load:bill-audit
```

`BASE_URL` defaults to `http://localhost:3002`. This script does not read a
caregiver token; it posts realistic bill payloads to `/bill/audit`.
Because `/bill/audit` is x402-protected, a live server needs a sandbox or testnet
facilitator/payment setup that accepts the requests; otherwise the run will
observe payment failures rather than audit performance.

## Reading results

Both scripts define k6 thresholds. A successful run ends with `PASS` and a zero
exit status; k6 exits non-zero when a threshold is breached. Review the
`checks` and HTTP request metrics in the summary, especially the
`http_req_failed` rate and `http_req_duration` percentile values. The custom
thresholds currently set by the scripts are:

| Script | Thresholds |
| --- | --- |
| `npm run load` | `errors_500` count = 0; `success_rate` = 100%; `agent_run_duration_ms` p95 < 30s |
| `npm run load:bill-audit` | `errors_5xx` count = 0; `success_rate` > 99%; `bill_audit_duration_ms` p95 < 2s |

The summary's `thresholds` section shows each condition as met or breached.