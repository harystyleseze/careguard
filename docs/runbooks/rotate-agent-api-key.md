# Rotate Agent API Key (`AGENT_API_KEY`)

## Why rotate

`AGENT_API_KEY` secures all `/agent/*` endpoints (such as running the agent, updating policies, and resetting spending logs). Rotating it regularly or immediately upon suspected leakage prevents unauthorized entities from controlling the AI agent or modifying its safety limits.

## Zero-Downtime Rotation Procedure

Since the dashboard and other clients need to transition to the new key, a direct swap would cause client requests to fail with `401 Unauthorized` during the deployment window. Follow this three-phase process to rotate the key with zero downtime.

---

### Phase 1: Support Dual Keys (Temporary)

1. Generate a new API key:
   ```bash
   openssl rand -hex 32
   ```

2. Temporarily update the `requireApiKey` middleware in [shared/auth.ts](file:///Users/favoureze/careguard/shared/auth.ts) to accept both the old and new keys:
   ```typescript
   const oldKey = process.env.AGENT_API_KEY;
   const newKey = process.env.NEW_AGENT_API_KEY; // Add this temporarily

   const isValid = (oldKey && safeCompare(token, oldKey)) || 
                   (newKey && safeCompare(token, newKey));
   ```

3. Set the new key as `NEW_AGENT_API_KEY` in your backend environment configuration (e.g., Render dashboard, Kubernetes secrets, or `.env`).

4. Redeploy the backend services. The backend will now accept requests authenticated with either the old key or the new key.

---

### Phase 2: Update Clients & Dashboard

1. Update the `NEXT_PUBLIC_AGENT_API_KEY` environment variable in your frontend/dashboard environment or build configuration to use the new key.

2. Rebuild and redeploy the dashboard. Once deployed, the dashboard will begin sending the new key in the `Authorization` header and SSE query parameters.

---

### Phase 3: Remove the Old Key

1. Update the backend environment configuration:
   - Remove `AGENT_API_KEY` (the old key).
   - Rename `NEW_AGENT_API_KEY` to `AGENT_API_KEY`.

2. Revert the temporary changes in the `requireApiKey` middleware in [shared/auth.ts](file:///Users/favoureze/careguard/shared/auth.ts) to only authenticate against the single `AGENT_API_KEY`.

3. Redeploy the backend services. The rotation is now complete, and the old key is fully revoked.

---

## Verification

After completing the rotation, verify that:
1. The dashboard loads normally, displays the agent status, and can update policies.
2. The backend logs do not show `401 Unauthorized` errors for legitimate dashboard requests.
3. Sending a request with the old key returns `401 Unauthorized`.
