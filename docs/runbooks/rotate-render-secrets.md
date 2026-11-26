# Rotate Render Secrets (`render.yaml`)

## Why `sync: false` in Render Blueprint

In `render.yaml`, secret environment variables (such as `AGENT_SECRET_KEY`, `CAREGIVER_SECRET_KEY`, `PHARMACY_*_SECRET_KEY`, `MPP_SECRET_KEY`, `LLM_API_KEY`, etc.) are declared with `sync: false`.

This is required by Render so that secret values are managed securely via the Render Dashboard or Render API rather than being committed to version control in the repository blueprint file.

Because Render does not automatically restart running Web Services when environment variables with `sync: false` are updated in the Dashboard, secret key updates will remain invisible to the running Node.js process until a reload or restart is triggered.

## Zero-Downtime Secret Rotation (SIGHUP)

For in-process secret reloads (such as `AGENT_SECRET_KEY` used by x402 signers), the application supports signal-driven cache invalidation:

1. Update the secret value in the Render Dashboard under **Environment Variables** or via the Render REST API.
2. Connect to the service shell or send a `SIGHUP` signal to the Node process:

```bash
# Send SIGHUP to the running node process
kill -HUP $(pgrep -f "node.*server")
```

3. Confirm cache invalidation in application logs:
```
[x402] SIGHUP received — signer cache invalidated, will reload on next call
```

## Manual Service Restart (Alternative)

If `SIGHUP` cannot be sent or for secrets that are evaluated only at boot time (e.g., database connection parameters or listening ports):

1. Go to the Render Dashboard.
2. Select your service (`careguard-api`).
3. Click **Manual Deploy** -> **Clear Build Cache & Deploy** or **Restart Service**.

## Smoke Testing Rotation

1. Update `AGENT_SECRET_KEY` in the environment.
2. Send `SIGHUP` signal to the running server.
3. Make an x402 API query (e.g. `GET /pharmacy/compare?drug=lisinopril`).
4. Verify the response succeeds without downtime and logs confirm new key usage.

## Game-Day Drill

See [docs/drills/965-render-secret-rotation.md](../drills/965-render-secret-rotation.md) and `scripts/drills/drill-render-secret-rotation.ts` for the full staging rehearsal procedure.
