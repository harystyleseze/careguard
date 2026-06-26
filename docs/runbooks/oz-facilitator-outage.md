# Runbook: OZ Facilitator Outage

**Symptom**

Any of the following:

- `GET /health` returns `{ "ready": false }` with `checks.ozFacilitator: false`.
- `POST /agent/run` responses contain tool errors like `"x402 payment failed"` or `"402 Payment Required"` with no successful settlement.
- Logs show repeated lines such as:
  ```
  [x402] facilitator unreachable
  ```
- The dashboard shows the agent failing on every pharmacy price query or bill audit request.

**Impact**

All tools that call protected x402 endpoints (`pharmacy-prices`, `bill-audit`, `drug-interaction`) will fail for every user session. The agent cannot complete any request that requires a paid API query. Free endpoints (e.g. `GET /bill`) remain unaffected.

CareGuard currently runs in **fail-closed** mode for x402: if the OZ facilitator cannot verify a payment, the request returns an error rather than proceeding without payment. This is intentional — proceeding without payment confirmation could result in unsettled Stellar transactions and broken audit trails.

---

## Diagnosis

**1. Check the readiness probe**

```sh
curl -s https://<your-render-url>/health | jq .
```

Look for `"checks": { "ozFacilitator": false }`. If `ozFacilitatorReachable` is `false` and `OZ_FACILITATOR_API_KEY` is set, the middleware has not completed a successful facilitator handshake since the last server start.

> Note: `ozFacilitatorReachable` is set to `true` by x402 middleware on the first successful payment verification after startup (see `server.ts:208`). A freshly restarted server with no traffic will show `false` until the first successful x402 call — this is not an outage on its own.

**2. Check OZ status**

Visit the OpenZeppelin Channels status page or check their Discord. OZ facilitator outages are typically announced there within minutes.

**3. Check your API key**

```sh
curl -s https://<your-render-url>/health | jq '.env.OZ_FACILITATOR_API_KEY'
# Should not be null/empty
```

If the key is missing, that is a misconfiguration, not an OZ outage. See [rotate-secrets.md](rotate-secrets.md).

**4. Inspect recent logs**

On Render, open the service logs and filter for `x402`. Look for HTTP status codes returned by the facilitator (401 = bad key, 503 = OZ down, timeout = network issue).

---

## What to tell users

During a confirmed OZ facilitator outage, respond to user reports with:

> "We are aware of an issue with our payment infrastructure. Pharmacy price queries and bill audits are temporarily unavailable. Your wallet has not been charged. We are monitoring the situation and will restore service as soon as the upstream provider recovers."

The agent will return a descriptive error rather than a partial result — no USDC is deducted for failed x402 calls.

---

## Mitigation

**Option A — Wait and monitor (recommended for short outages < 30 min)**

OZ facilitator outages are typically brief. Monitor the OZ status page and Render logs. No action needed — the server will resume normal operation automatically once the facilitator is reachable again. The `ozFacilitatorReachable` flag resets on the next successful payment.

**Option B — Restart the server**

A restart clears the `ozFacilitatorReachable` flag and forces a fresh connection attempt. Useful if the server appears stuck after the facilitator has recovered.

```sh
# On Render: deploy → Manual Deploy → Clear build cache & deploy
# or trigger a restart from the Render dashboard
```

**Option C — Fail-open (last resort, not recommended)**

There is currently no built-in fail-open flag. Do not modify the x402 middleware to skip payment verification in production — this would allow unauthenticated access to paid APIs and break the audit trail. If extended downtime requires a business decision to proceed without payments, escalate to the project lead.

---

## Remediation

Once the OZ facilitator recovers:

1. Verify `GET /health` returns `"ozFacilitator": true` after the first paid API call (or restart the server to trigger a fresh startup check).
2. Run a manual agent session through the dashboard to confirm pharmacy prices and bill audits work end-to-end.
3. Check `data/audit.log.jsonl` — any sessions that errored during the outage will have `status: "error"` entries. No manual remediation of the ledger is needed (no charges were made for failed calls).

---

## Post-mortem template

```
Date / duration:
Scope: x402 tools unavailable for all users
Root cause: [ OZ facilitator unreachable | API key invalid | Network issue ]
Detection lag: (time from first failure to incident declared)
Mitigation taken:
Remediation:
User communications sent: [ yes | no ]
Action items:
  - [ ] Add synthetic monitoring for /health?checks=ozFacilitator
  - [ ] Evaluate fail-open policy for non-financial endpoints
```

---

## Related

- `server.ts:208-239` — `ozFacilitatorReachable` flag and `/health` check implementation
- `agent/tools.ts` — x402 payment logic per tool
- [rotate-secrets.md](rotate-secrets.md) — if outage is caused by an expired/invalid API key
- [wallet-low.md](wallet-low.md) — if the agent wallet ran dry mid-session
- Issue [#130](https://github.com/harystyleseze/careguard/issues/130) — runbook collection spec
