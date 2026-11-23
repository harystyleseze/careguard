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

## Agent key-rotation load test

`npm run load:agent-run-rotation` runs `load/agent-run-rotation.js`, which keeps
20 VUs hitting `/agent/run` while a single VU rotates `AGENT_SECRET_KEY`
mid-run (env update + SIGHUP). It verifies the zero-downtime claim in
[`docs/runbooks/rotate-agent-key.md`](../docs/runbooks/rotate-agent-key.md)
under sustained concurrent traffic rather than the runbook's single-request
manual check.

k6 cannot modify another process's environment or send it a signal, so the
agent must be started with the test-only preload hook enabled:

```sh
LOAD_TEST_ROTATION_HOOK=1 ROTATION_HOOK_PORT=3006 \
  node --import ./load/rotation-hook.mjs --import tsx server.ts
```

Then, in another shell, generate a new Stellar secret and run the test:

```sh
NEW_AGENT_SECRET_KEY="$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().secret())")" \
  npm run load:agent-run-rotation
```

The hook is inert unless `LOAD_TEST_ROTATION_HOOK=1` and is never mounted by
the application itself. Optional vars: `BASE_URL`, `ROTATION_HOOK_URL`,
`ROTATION_START` (default `10s`), `ITERATIONS` (default `40`).

Thresholds fail the run on any 500, rotation-boundary error, misrouted,
duplicate, or mixed-key payment. The summary also compares the observed
`transactionCount`/service-fee deltas with the expected run count and reports
whether the runbook's zero-downtime claim was CONFIRMED or REFUTED.

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
| `npm run load:agent-run-rotation` | `errors_500`, `rotation_boundary_errors`, `misrouted_payments`, `duplicate_payments`, `mixed_key_settlement` all count = 0; `success_rate` = 100%; `agent_run_duration_ms` p95 < 30s |
| `npm run load:bill-audit` | `errors_5xx` count = 0; `success_rate` > 99%; `bill_audit_duration_ms` p95 < 2s |

The summary's `thresholds` section shows each condition as met or breached.