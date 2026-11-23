# Runbook: Webhook Secret Rotation

**Applies to:** `POST /webhooks/stellar/deposit` and any future webhook endpoints
**Owner:** Platform / Security
**Last reviewed:** 2026-06-27

---

## Overview

The HMAC webhook secret (`WEBHOOK_SECRET`) authenticates inbound Stellar deposit
events.  Rotate it whenever:

- A secret is suspected or confirmed to have been compromised.
- A vendor/partner that held the secret is offboarded.
- Routine rotation schedule is triggered (recommend every 90 days).

---

## Prerequisites

- Access to the secret store (Render secret files or `.env` on the deployment).
- Ability to restart the agent service.
- Coordination with the party that sends webhooks (they must update their
  signing secret to match at the same time, or during the grace-period window).

---

## Step-by-step

### 1. Generate a new secret

```bash
openssl rand -hex 32
```

Keep the output — this is `NEW_SECRET`.

### 2. Enable dual-secret mode (zero-downtime)

`verifyWebhook` accepts both `secret` and `fallbackSecret` (and automatically
reads `WEBHOOK_SECRET_NEW` + `WEBHOOK_SECRET` when called with no arguments).
To rotate without dropping events, deploy with both secrets active:

```ts
// In agent/server.ts:
import { verifyWebhook } from "../shared/verify-webhook.ts";

app.post(
  "/webhooks/stellar/deposit",
  express.raw({ type: "application/json" }),
  verifyWebhook({
    secret: process.env.WEBHOOK_SECRET_NEW,
    fallbackSecret: process.env.WEBHOOK_SECRET,
  }),
  // TODO: remove fallbackSecret once all senders have switched
  (req, res) => { /* ... */ },
);
```

Set both env vars:

| Variable | Value |
|---|---|
| `WEBHOOK_SECRET` | OLD value (kept for reference) |
| `WEBHOOK_SECRET_NEW` | Newly generated secret |

Deploy this version.

### 3. Update the sender

Provide `NEW_SECRET` to the party that signs outbound webhooks (e.g., the
Stellar Horizon subscription service or your ops team's script).  They must
begin signing with the new secret and stop using the old one.

Typical turnaround: **≤ 15 minutes**.

### 4. Verify with a test event

Send a synthetic deposit webhook signed with the new secret and confirm the
agent returns `200 { "status": "received" }`:

```bash
TS=$(date +%s)
BODY='{"amount":"1","asset":"USDC","tx":"test"}'
SIG=$(echo -n "${TS}.${BODY}" | openssl dgst -sha256 -hmac "$NEW_SECRET" | awk '{print "sha256="$2}')

curl -s -X POST https://<agent-host>/webhooks/stellar/deposit \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Timestamp: $TS" \
  -H "X-Webhook-Id: rotation-test-$(date +%s)" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

Expected response:

```json
{"status":"received"}
```

### 5. Remove the old secret

Once the sender is confirmed to be using the new secret:

1. Remove the dual-secret fallback code from `agent/server.ts`.
2. Rename `WEBHOOK_SECRET_NEW` → `WEBHOOK_SECRET` in the environment.
3. Delete the old `WEBHOOK_SECRET` value from the secret store.
4. Deploy.

### 6. Record the rotation

Add an entry to the audit trail (Linear / incident log):

```
Date: <today>
Rotated: WEBHOOK_SECRET
Reason: <scheduled | compromise | offboarding>
Performed by: <your name>
```

---

## Rollback

If the new secret causes failures before the sender has updated:

1. Revert the `WEBHOOK_SECRET` env var to the old value in the secret store.
2. Restart the service.
3. Coordinate with the sender to retry.

---

## Security notes

- The secret must be at least 32 bytes of cryptographically random data
  (`openssl rand -hex 32` produces 64 hex chars = 32 bytes).
- Never log the raw secret.  The middleware logs only the webhook-id and path
  on failures.
- Replay window is 10 minutes; events seen during the rotation will be
  de-duplicated by `X-Webhook-Id` in Redis/in-process cache.
- The timestamp tolerance is ±5 minutes.  Ensure sender and receiver clocks are
  NTP-synced to avoid spurious 400s during rotation.

---

## Game-Day Drill

Rehearse the dual-secret cutover end-to-end in staging without dropping events:

1. **Overlap window:** Deploy with both `WEBHOOK_SECRET_NEW` and `WEBHOOK_SECRET` set (using `verifyWebhook({ secret: process.env.WEBHOOK_SECRET_NEW, fallbackSecret: process.env.WEBHOOK_SECRET })`). Confirm events signed with either secret return `200`.
2. **Synthetic test event:** Run the HMAC-signed `curl` command from Step 4 above and confirm `200 {"status":"received"}`.
3. **Timestamp & replay windows:**
   - Send a request at `now - 299s` (accepted) and `now - 301s` (rejected with `400`, confirming ±5 min tolerance).
   - Replay the same `X-Webhook-Id` within 10 minutes and confirm `200 {"status":"already_processed"}`.
4. **Old-secret removal:** Remove `WEBHOOK_SECRET` / `fallbackSecret`, deploy with only the new secret, and confirm events signed with the old secret are rejected with `400`.
5. **Follow-ups:** File a follow-up issue for any clock-skew or de-dup edge case observed during the drill.

| Date | Environment | Overlap Verified? | Old Secret Rejected? | Edge Cases Filed |
|------|-------------|-------------------|----------------------|------------------|
| _TBD_ | staging | _TBD_ | _TBD_ | _TBD_ (#970) |
