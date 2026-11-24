# Game-Day Drill #965: Render `sync:false` Secret Rotation

> **Issue:** [#965](https://github.com/harystyleseze/careguard/issues/965)  
> **Runbook:** [docs/runbooks/rotate-render-secrets.md](../runbooks/rotate-render-secrets.md)  
> **Target Environment:** Staging Render Web Service (`careguard-api`)

## Objective

Rehearse rotating a `sync: false` secret environment variable (`AGENT_SECRET_KEY`) in a real Render staging deployment to confirm:
1. Render does **not** auto-restart the running Node.js process when a `sync: false` env var is updated.
2. Sending `SIGHUP` via Render Shell invalidates the x402 signer cache immediately (`[x402] SIGHUP received — signer cache invalidated, will reload on next call`).
3. The Manual Service Restart path works as a fallback and its recovery time is measured.

---

## Pre-Drill Checklist

- [ ] Staging Render service (`careguard-api`) is healthy (`GET /health` -> `200 { "status": "ok" }`, `GET /ready` -> `200`).
- [ ] `render.yaml` declares `AGENT_SECRET_KEY` (and other secrets) with `sync: false`.
- [ ] A secondary funded Stellar testnet secret key is ready for rotation, plus the original key for rollback.
- [ ] Render Dashboard access (or `RENDER_API_KEY`) and Render Shell access are verified.

---

## Procedure

### Phase 1 — Baseline Verification

1. Record the current running process PID and uptime in Render Shell:
   ```bash
   pgrep -af "node.*server"
   ```
2. Run the drill probe script against staging to capture baseline `/health`, `/ready`, and `/pharmacy/compare?drug=lisinopril` behaviour:
   ```bash
   node --import tsx scripts/drills/drill-render-secret-rotation.ts \
     --url https://<staging-service>.onrender.com \
     --mode sighup \
     --baseline-only
   ```

### Phase 2 — Update `sync:false` Secret in Render (Confirm Stale Behaviour)

1. Update `AGENT_SECRET_KEY` in **Render Dashboard -> Environment -> Environment Variables** (or via Render REST API `PUT /v1/services/{serviceId}/env-vars`).
2. **Do not** click "Save & Deploy" / restart if prompted for a manual deploy; save the env var change only.
3. Observe the service for **60+ seconds**:
   - Confirm the process PID in Render Shell has **not** changed (Render did not auto-restart).
   - Confirm `/health` remains `200` with no restart gap.
   - Note: within the 60s `X402_SIGNER_TTL_MS` window, `getX402Fetch()` continues using the cached old signer unless `SIGHUP` is sent.

### Phase 3 — SIGHUP Reload Path

1. In Render Shell, send `SIGHUP` to the running Node process:
   ```bash
   kill -HUP $(pgrep -f "node.*server")
   ```
2. Confirm the log line in Render Logs:
   ```text
   [x402] SIGHUP received — signer cache invalidated, will reload on next call
   ```
3. Run an x402 query (`GET /pharmacy/compare?drug=lisinopril`) and verify it succeeds with `200` and zero downtime.
4. Record the cutover latency (time from `SIGHUP` to first successful x402 response).

### Phase 4 — Manual Restart Alternative Path (Separate Rehearsal)

1. Update `AGENT_SECRET_KEY` back to the original key (or a third test key) in the Render Dashboard.
2. Start the drill script in `--mode restart` to continuously poll `/health` and measure downtime:
   ```bash
   node --import tsx scripts/drills/drill-render-secret-rotation.ts \
     --url https://<staging-service>.onrender.com \
     --mode restart \
     --duration-ms 180000
   ```
3. In Render Dashboard, trigger **Manual Deploy -> Restart Service** (or **Clear Build Cache & Deploy**).
4. Record:
   - Time from clicking Restart to `/health` returning non-200 / connection reset (drain start)
   - Total unavailable window (seconds)
   - Time until `/health` and `/ready` return `200`

---

## Execution Log Template

| Metric / Observation | Recorded Value | Notes |
|---|---|---|
| Drill Date (UTC) | | |
| Operator | | |
| Staging Service URL | | |
| Pre-rotation PID | | |
| Process auto-restarted on `sync:false` update? | Yes / No (Expected: **No**) | |
| `SIGHUP` sent timestamp (UTC) | | |
| `[x402] SIGHUP received` log observed? | Yes / No | |
| SIGHUP cutover latency (ms) | | |
| Manual Restart total duration (s) | | |
| Manual Restart unavailability window (s) | | |
| Discrepancies found (file follow-up issue) | | |

---

## Acceptance Criteria Mapping

- [ ] Secret env var updated via Render Dashboard/API on staging service
- [ ] Confirmed running process does NOT pick up new value without SIGHUP/restart
- [ ] `SIGHUP` sent via Render Shell and `[x402] SIGHUP received` log confirmed
- [ ] Manual-restart alternative path separately rehearsed and timed
- [ ] Any discrepancy from documented behaviour filed as a follow-up issue
