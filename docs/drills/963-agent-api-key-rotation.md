# Game-Day Drill #963: Zero-Downtime `AGENT_API_KEY` Rotation in Staging

> **Issue:** [#963](https://github.com/harystyleseze/careguard/issues/963)  
> **Runbook:** [docs/runbooks/rotate-agent-api-key.md](../runbooks/rotate-agent-api-key.md)  
> **Target Environment:** Staging

## Objective

Rehearse the three-phase dual-key `AGENT_API_KEY` rotation procedure in [rotate-agent-api-key.md](../runbooks/rotate-agent-api-key.md) against a running staging deployment while a continuous background client polls `/agent/status`, confirming:

1. Phase 1 (dual-key support), Phase 2 (client & dashboard cutover), and Phase 3 (old-key removal) execute in sequence without causing `401 Unauthorized` blips for active clients.
2. Total rotation window stays within the agreed target duration (**≤ 15 minutes / 900 s**).
3. All items in the runbook's Verification checklist pass after Phase 3 completes.
4. Error-prone manual steps are documented and flagged for automation.

---

## Pre-Drill Checklist

- [ ] Staging backend (`careguard-api`) and staging dashboard are healthy (`GET /health` -> `200`, `GET /ready` -> `200`).
- [ ] Current staging `AGENT_API_KEY` is known and exported as `OLD_AGENT_API_KEY`.
- [ ] A fresh 256-bit hex key is generated and exported as `NEW_AGENT_API_KEY`:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Log streaming is open on the staging backend (filtering for `401` and `Unauthorized`) to verify zero unexpected 401 logs during the drill.
- [ ] Target rotation window is agreed (**Target: ≤ 15 minutes** from Phase 1 start to Phase 3 verification).

---

## Procedure

### Phase 0 — Start Continuous Polling Client

Start the drill polling script in a dedicated terminal before touching any environment variables or code. It continuously polls `GET /agent/status` with the active key and records every HTTP status code and timestamp:

```bash
OLD_AGENT_API_KEY="<current-staging-key>" \
NEW_AGENT_API_KEY="<generated-new-key>" \
node --import tsx scripts/drills/drill-agent-api-key-rotation.ts \
  --url https://<staging-service>.onrender.com \
  --interval-ms 1000 \
  --duration-ms 900000 \
  --target-duration-ms 900000
```

Confirm baseline `200 OK` responses before starting Phase 1. Record `T0` (drill start time).

---

### Phase 1 — Support Dual Keys (Temporary)

1. Temporarily update `requireApiKey` in `shared/auth.ts` (per `rotate-agent-api-key.md`) to accept both `AGENT_API_KEY` and `NEW_AGENT_API_KEY`.
2. Set `NEW_AGENT_API_KEY` in the staging backend environment configuration.
3. Redeploy the staging backend service.
4. Confirm in the polling script output:
   - Continuous requests using `OLD_AGENT_API_KEY` remain `200 OK` with **0** `401` responses during and after redeploy.
   - Probe requests using `NEW_AGENT_API_KEY` transition from `401` to `200 OK` once the dual-key backend is live.
5. Record `T1` (dual-key live timestamp).

---

### Phase 2 — Update Clients & Dashboard

1. Update `NEXT_PUBLIC_AGENT_API_KEY` in the staging dashboard build/environment configuration to `NEW_AGENT_API_KEY`.
2. Rebuild and redeploy the staging dashboard.
3. Open the staging dashboard in a browser and confirm it loads normally and authenticates `/agent/*` requests (including SSE `/agent/stream`) using `NEW_AGENT_API_KEY`.
4. Confirm in the polling script output and backend logs that **0** `401 Unauthorized` responses occurred during dashboard rebuild/cutover.
5. Record `T2` (dashboard cutover complete timestamp).

---

### Phase 3 — Remove the Old Key

1. Update the staging backend environment configuration:
   - Replace `AGENT_API_KEY` with the value of `NEW_AGENT_API_KEY`.
   - Remove `NEW_AGENT_API_KEY`.
2. Revert the temporary dual-key change in `shared/auth.ts` so `requireApiKey` only checks `AGENT_API_KEY`.
3. Redeploy the staging backend service.
4. Record `T3` (old-key removal complete timestamp) and stop the polling client (`Ctrl+C`) once the post-Phase-3 probes settle.
5. Run the post-rotation verification check:
   ```bash
   OLD_AGENT_API_KEY="<old-key>" \
   NEW_AGENT_API_KEY="<new-key>" \
   node --import tsx scripts/drills/drill-agent-api-key-rotation.ts \
     --url https://<staging-service>.onrender.com \
     --verify-only
   ```

---

## Verification Checklist (from Runbook)

Execute and record all three items from `docs/runbooks/rotate-agent-api-key.md`:

- [ ] **Dashboard loads**: Staging dashboard loads normally, displays agent status, and can update policies.
- [ ] **No 401 logs**: Backend logs show `0` `401 Unauthorized` errors for legitimate dashboard/polling requests across Phases 1–3.
- [ ] **Old key rejected**: Direct request to `GET /agent/status` with `OLD_AGENT_API_KEY` returns `401 Unauthorized`; request with `NEW_AGENT_API_KEY` returns `200 OK`.

---

## Manual Steps Flagged for Automation

Record any friction observed during the drill. Known candidates from `rotate-agent-api-key.md`:

| Step | Friction / Risk | Proposed Automation |
|---|---|---|
| Phase 1 & 3: Editing and reverting `shared/auth.ts` | Requires two temporary code edits and two extra deploys; easy to forget the Phase 3 revert, leaving dual-key support permanently enabled. | Update `requireApiKey` in `shared/auth.ts` to natively support an optional `NEW_AGENT_API_KEY` (or comma-separated `AGENT_API_KEYS`) env var so rotation is config-only. |
| Phase 1–3: Manual env-var updates across backend & dashboard | Copy-paste typos between `NEW_AGENT_API_KEY`, `NEXT_PUBLIC_AGENT_API_KEY`, and `AGENT_API_KEY` can cause an outage during Phase 3. | Add a rotation helper script (or Render API script) that validates key format, updates env vars in sequence, and verifies `/agent/status` before advancing phases. |
| Post-Phase 3: Old-key rejection check | Easy to skip under time pressure. | Automated in `scripts/drills/drill-agent-api-key-rotation.ts --verify-only`. |

---

## Execution Log Template

| Metric / Observation | Recorded Value | Notes |
|---|---|---|
| Drill Date (UTC) | | |
| Operator | | |
| Staging Backend URL | | |
| Staging Dashboard URL | | |
| `T0` Drill / polling start (UTC) | | |
| `T1` Phase 1 dual-key live (UTC) | | |
| `T2` Phase 2 dashboard cutover complete (UTC) | | |
| `T3` Phase 3 old-key removed (UTC) | | |
| Total rotation window (`T3 - T0`) | | Target: ≤ 15 min (900 s) |
| Total polling requests sent | | |
| Unexpected `401` count across Phases 1–3 | | Expected: `0` |
| Post-Phase-3 old-key check status | | Expected: `401` |
| Post-Phase-3 new-key check status | | Expected: `200` |
| Dashboard loads & updates policy? | Yes / No | |
| Backend logs free of legitimate `401`s? | Yes / No | |
| Follow-up issues filed | | |

---

## Acceptance Criteria Mapping

- [ ] Drill executes Phase 1 (dual-key support), Phase 2 (client cutover), and Phase 3 (old-key removal) against staging in sequence
- [ ] Continuous polling client confirms zero unexpected `401`s across all three phases
- [ ] Total rotation window timed against target duration (≤ 15 min)
- [ ] Verification checklist in `docs/runbooks/rotate-agent-api-key.md` executed and results recorded
- [ ] Error-prone manual steps flagged for automation
