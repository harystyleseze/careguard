# Game-Day Drill #964: SIGHUP `AGENT_SECRET_KEY` Rotation Under Live Traffic

> **Issue:** [#964](https://github.com/harystyleseze/careguard/issues/964)  
> **Runbook:** [docs/runbooks/rotate-agent-key.md](../runbooks/rotate-agent-key.md)  
> **Target Environment:** Staging

## Objective

Rehearse rotating `AGENT_SECRET_KEY` via `SIGHUP` while continuous x402 payment traffic (`compare_pharmacy_prices` / `/pharmacy/compare`) is in flight, confirming:
1. `[x402] SIGHUP received — signer cache invalidated, will reload on next call` is logged mid-traffic.
2. In-flight requests already holding the pre-SIGHUP signer complete/settle on the old key.
3. The very next new request after SIGHUP picks up the new key.
4. Separately, without `SIGHUP`, the 60-second `X402_SIGNER_TTL_MS` fallback path rotates to the new key once the TTL expires.

---

## Pre-Drill Checklist

- [ ] Both the old and new Stellar testnet agent accounts are funded with XLM + USDC.
- [ ] Staging server is running with `MOCK_NETWORK=0` (real x402 signing).
- [ ] Log streaming is open (`[x402]` filter) to capture exact SIGHUP and signer reload timestamps.

---

## Procedure

### Phase 1 — SIGHUP Mid-Traffic Cutover

1. Start continuous x402-triggering traffic against staging:
   ```bash
   node --import tsx scripts/drills/drill-sighup-key-rotation.ts \
     --url https://<staging-service>.onrender.com \
     --concurrency 4 \
     --duration-ms 45000
   ```
2. ~10 seconds into the traffic run, update `AGENT_SECRET_KEY` to the new key in the staging environment.
3. Immediately send `SIGHUP` to the running process:
   ```bash
   kill -HUP $(pgrep -f "node.*server")
   ```
4. Record the exact timestamp of `SIGHUP` and confirm the log line:
   ```text
   [x402] SIGHUP received — signer cache invalidated, will reload on next call
   ```
5. Inspect Stellar testnet explorer / payment receipts:
   - Confirm at least one request that started **before** `SIGHUP` settled using the **old** public key.
   - Confirm the next request started **after** `SIGHUP` settled using the **new** public key.
   - Confirm `0` failed requests due to key rotation.

### Phase 2 — 60-Second TTL Fallback (No SIGHUP)

1. Run the drill script in `--ttl-only` mode (80+ seconds):
   ```bash
   node --import tsx scripts/drills/drill-sighup-key-rotation.ts \
     --url https://<staging-service>.onrender.com \
     --ttl-only \
     --duration-ms 85000
   ```
2. ~10 seconds into the run, rotate `AGENT_SECRET_KEY` again and **do not** send `SIGHUP`.
3. Confirm:
   - Requests for up to 60 seconds after the previous cache population continue signing with the old key.
   - Once `X402_SIGNER_TTL_MS` (60,000 ms) elapses, the next request automatically reloads `AGENT_SECRET_KEY` and settles with the new key.

---

## Execution Log Template

| Metric / Observation | Recorded Value | Notes |
|---|---|---|
| Drill Date (UTC) | | |
| Old Agent Public Key | | |
| New Agent Public Key | | |
| `SIGHUP` timestamp (UTC) | | |
| `[x402] SIGHUP received` log observed? | Yes / No | |
| In-flight request ID settled on old key | | |
| First post-SIGHUP request ID settled on new key | | |
| Any mid-flight failures / 402 errors? | | |
| TTL-only cutover observed elapsed time (s) | | Expected <= 60s |
| Timing edge cases / follow-up issues filed | | |

---

## Acceptance Criteria Mapping

- [ ] Continuous x402-triggering requests (`compare_pharmacy_prices`) run throughout rotation
- [ ] `SIGHUP` sent mid-traffic and `[x402] SIGHUP received` log confirmed
- [ ] At least one in-flight request confirmed to settle on old key, next new request on new key
- [ ] 60-second TTL fallback path (no SIGHUP) separately verified
- [ ] Findings recorded and timing edge cases filed as follow-up issues
