# Game-Day Drill #967: Runtime `STELLAR_NETWORK` Switch via SIGHUP

> **Issue:** [#967](https://github.com/harystyleseze/careguard/issues/967)  
> **Runbook:** [docs/runbooks/switch-network.md](../runbooks/switch-network.md)  
> **Target Environment:** Staging

## Objective

Rehearse switching `STELLAR_NETWORK` between `testnet` and `public` at runtime via `SIGHUP`, confirming:
1. A `pay_for_medication` call issued within the 60-second TTL window before `SIGHUP` still uses the old network.
2. Sending `SIGHUP` invalidates the MPP client cache so the next `pay_for_medication` call constructs a fresh MPP client reading the updated `STELLAR_NETWORK`.
3. Startup guard: `STELLAR_NETWORK=public` without `OZ_FACILITATOR_API_KEY` refuses to start (`process.exit(1)`).
4. Startup guard: `MULTI_PHARMACY_MODE=true` without `PHARMACY_2_PUBLIC_KEY` refuses to start (`process.exit(1)`).

> [!WARNING]
> **Pre-Drill Static Code Findings (Verify & File Follow-Up):**
> - In `agent/tools.ts`, `mppClient` is currently initialized once at module load (`createMppClient(...)`) and `getMppClient()` returns it directly; `invalidateMppClientCache` (imported by `agent/__tests__/mpp-client-lazy.test.ts`) is not currently exported in `agent/tools.ts`.
> - In `server.ts` (`NETWORK`) and `shared/x402-signer.ts` (`STELLAR_CONFIG` / `x402SchemeId`), `STELLAR_NETWORK` is also resolved at module load time.
> - Expect `SIGHUP` alone NOT to switch `mppClient` or `server.ts` `NETWORK` until lazy TTL + `SIGHUP` invalidation is restored in `agent/tools.ts` — record this exact behaviour during the drill and file/link the follow-up issue.

---

## Pre-Drill Checklist

- [ ] Staging starts on `STELLAR_NETWORK=testnet` with `OZ_FACILITATOR_API_KEY` set.
- [ ] Testnet and public-network dry-run/staging credentials are prepared.
- [ ] Access to staging shell (`kill -HUP`) and process startup logs is verified.

---

## Procedure

### Phase 1 — Verify 60s TTL Window Before SIGHUP

1. Trigger an initial `pay_for_medication` (or `/agent/run`) call on `testnet` to warm the MPP client cache.
2. Update `STELLAR_NETWORK=public` in the staging environment **without** sending `SIGHUP`.
3. Within 60 seconds, issue another `pay_for_medication` call and verify it still targets `testnet` (old network).

### Phase 2 — Switch Network via SIGHUP

1. Send `SIGHUP` to the running process:
   ```bash
   kill -HUP $(pgrep -f "node.*server")
   ```
2. Trigger `pay_for_medication` and inspect logs / Stellar Horizon target to verify whether a fresh MPP client was constructed reading `STELLAR_NETWORK=public`.
3. Run the drill helper script to record probe responses and guard checks:
   ```bash
   node --import tsx scripts/drills/drill-network-switch.ts \
     --url https://<staging-service>.onrender.com
   ```
4. Switch `STELLAR_NETWORK` back to `testnet` and send `SIGHUP` (or restart) to restore staging.

### Phase 3 — Verify Startup Guards

Run the following startup guard checks against a staging/isolated process (never against live production traffic):

1. **`STELLAR_NETWORK=public` without `OZ_FACILITATOR_API_KEY`:**
   ```bash
   STELLAR_NETWORK=public OZ_FACILITATOR_API_KEY="" node --import tsx server.ts
   ```
   Expected: exits with code `1` and writes to `stderr`:
   `Missing/invalid env: OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public`

2. **`MULTI_PHARMACY_MODE=true` without `PHARMACY_2_PUBLIC_KEY`:**
   ```bash
   MULTI_PHARMACY_MODE=true PHARMACY_2_PUBLIC_KEY="" node --import tsx server.ts
   ```
   Expected: exits with code `1` and writes to `stderr`:
   `Missing/invalid env: PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true`

---

## Execution Log Template

| Metric / Observation | Recorded Value | Notes |
|---|---|---|
| Drill Date (UTC) | | |
| Pre-SIGHUP within-TTL network used | | Expected: `testnet` |
| `SIGHUP` sent timestamp (UTC) | | |
| Post-SIGHUP `pay_for_medication` network used | | Note if full restart was required |
| `STELLAR_NETWORK=public` without `OZ_FACILITATOR_API_KEY` exit code | | Expected: `1` |
| `MULTI_PHARMACY_MODE=true` without `PHARMACY_2_PUBLIC_KEY` exit code | | Expected: `1` |
| Undocumented restart-vs-SIGHUP edge cases | | |

---

## Acceptance Criteria Mapping

- [ ] `STELLAR_NETWORK` switched from `testnet` to `public` via SIGHUP in staging; next `pay_for_medication` verified
- [ ] Call within 60s TTL window before SIGHUP confirmed to use old network
- [ ] Server confirmed to refuse start on `public` without `OZ_FACILITATOR_API_KEY`
- [ ] Server confirmed to refuse start with `MULTI_PHARMACY_MODE=true` without `PHARMACY_2_PUBLIC_KEY`
- [ ] Findings recorded and restart-vs-SIGHUP edge cases filed as follow-ups
