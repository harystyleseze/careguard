# Game-Day Drill #962: OZ Facilitator Outage (Fail-Closed End-to-End)

> **Issue:** [#962](https://github.com/harystyleseze/careguard/issues/962)  
> **Runbook:** [docs/runbooks/oz-facilitator-outage.md](../runbooks/oz-facilitator-outage.md)  
> **Target Environment:** Staging

## Objective

Simulate an OpenZeppelin (OZ) x402 facilitator outage by blocking outbound egress to `X402_FACILITATOR_URL` in staging and verifying:
1. Readiness probe (`GET /ready`) reports `checks.ozFacilitator` degraded when `OZ_FACILITATOR_API_KEY` is set and the facilitator is unreachable.
2. Paid x402 requests (`/pharmacy/compare` or `/bill/audit`) fail closed (`402` / `503`) **without** deducting USDC from the agent wallet.
3. Detection-to-user-communication meets the target SLA using the documented user-communication script.
4. Restoring egress allows the next successful x402 call to flip `ozFacilitatorReachable` back to `true` (`GET /ready` -> `200`, `checks.ozFacilitator: true`).

> [!NOTE]
> **Static Code Alignment Note:**  
> In `server.ts`, `checks.ozFacilitator` is exposed on `GET /ready` (returning `"not yet verified"` with HTTP `503` and `status: "degraded"` when `ozFacilitatorReachable` is `false` and `OZ_FACILITATOR_API_KEY` is set), whereas `GET /health` is a fast liveness probe returning `{ "status": "ok" }`. Record whether `ozFacilitatorReachable` resets on failed facilitator calls or only remains `false` after startup/restart, and file any discrepancy as a follow-up issue.

---

## Pre-Drill Checklist

- [ ] Staging server is healthy with `OZ_FACILITATOR_API_KEY` configured.
- [ ] Baseline agent USDC balance recorded (`node --import tsx scripts/check-wallet-balance.ts` or Horizon check).
- [ ] Egress block mechanism ready (e.g., `iptables`/`nftables` drop rule, `/etc/hosts` sinkhole, or staging proxy toggle for `channels.openzeppelin.com`).
- [ ] Target detection-to-communication SLA defined (default: **300 seconds / 5 minutes**).

---

## Procedure

### Phase 1 — Baseline & Start Drill Timer

1. Verify `GET /ready` and a paid x402 call succeed before blocking egress:
   ```bash
   node --import tsx scripts/drills/drill-oz-facilitator-outage.ts \
     --url https://<staging-service>.onrender.com \
     --sla-seconds 300
   ```
2. Record the starting agent USDC balance.

### Phase 2 — Block Outbound Facilitator Egress

1. Block outbound traffic to `X402_FACILITATOR_URL` (`channels.openzeppelin.com`) in staging.
2. Start the detection timer (`T0 = egress blocked`).
3. Observe:
   - `GET /ready` response (`checks.ozFacilitator` and HTTP status).
   - Paid request (`GET /pharmacy/compare?drug=lisinopril` or `POST /bill/audit`) fails with an error (`503` / `402`).
   - Confirm **zero USDC deducted** from the agent wallet.
   - Confirm `data/audit.log.jsonl` records `status: "error"` without a settled payment.

### Phase 3 — Incident Communication SLA

1. When the outage is detected (`T_detect`), post the documented user-communication script from `docs/runbooks/oz-facilitator-outage.md`:
   > "We are aware of an issue with our payment infrastructure. Pharmacy price queries and bill audits are temporarily unavailable. Your wallet has not been charged. We are monitoring the situation and will restore service as soon as the upstream provider recovers."
2. Record `T_comm` and verify `(T_comm - T0) <= target SLA`.

### Phase 4 — Restore Egress & Verify Recovery

1. Remove the firewall/DNS/proxy block on `channels.openzeppelin.com`.
2. Execute a paid x402 call (`GET /pharmacy/compare?drug=lisinopril`).
3. Confirm `ozFacilitatorReachable` flips `true` and `GET /ready` returns `200` with `checks.ozFacilitator: true`.

---

## Execution Log Template

| Metric / Observation | Recorded Value | Notes |
|---|---|---|
| Drill Date (UTC) | | |
| Egress block method | | Firewall / DNS / Proxy |
| `T0` Egress blocked (UTC) | | |
| `T_detect` First failure / probe alert (UTC) | | |
| `T_comm` User communication sent (UTC) | | |
| Detection-to-communication elapsed (s) | | Target SLA: <= 300s |
| Pre-outage USDC balance | | |
| Post-outage USDC balance | | Expected: identical |
| `GET /ready` during outage | | |
| Post-recovery `GET /ready` (`checks.ozFacilitator`) | | Expected: `true` |
| Discrepancies / follow-up issues filed | | |

---

## Acceptance Criteria Mapping

- [ ] Staging egress to facilitator URL blocked
- [ ] Readiness endpoint (`GET /ready` / `GET /health`) `checks.ozFacilitator` behaviour confirmed
- [ ] Pharmacy-price or bill-audit request confirmed to fail without deducting USDC (fail-closed)
- [ ] Detection-to-communication timed against target SLA
- [ ] Recovery verified: egress restored and `ozFacilitatorReachable` flips `true` on next successful call
