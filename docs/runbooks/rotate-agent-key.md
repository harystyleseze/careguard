# Rotate Agent Secret Key (`AGENT_SECRET_KEY`)

## Why rotate

`AGENT_SECRET_KEY` controls the Stellar keypair that signs x402 API payments and MPP medication orders. Rotating it limits the blast radius if the key is leaked or compromised. See [docs/runbooks/leaked-secret.md](leaked-secret.md) for the response runbook.

## Zero-downtime rotation (SIGHUP)

The agent re-reads `AGENT_SECRET_KEY` from the environment on a 60-second TTL. Sending SIGHUP forces immediate cache invalidation so the new key is picked up on the very next x402 payment — without stopping the process.

```bash
# 1. Set the new key in the environment (method depends on your deployment)
export AGENT_SECRET_KEY="<new-stellar-secret-key>"

# 2. Find the agent PID
pgrep -f "node.*agent/server"   # or check your process manager

# 3. Send SIGHUP to trigger immediate signer reload
kill -HUP <pid>
```

**Verify** the reload happened — the agent logs:
```
[x402] SIGHUP received — signer cache invalidated, will reload on next call
```

In-flight requests that were already signed with the old key complete normally. Only new x402 payments after the reload use the new key.

## Under-load verification

The single-request check above does not prove the zero-downtime claim under
concurrent traffic. `load/agent-run-rotation.js` keeps 20 VUs on `/agent/run`
and rotates the key partway through the run (env update + SIGHUP through the
test-only preload hook in `load/rotation-hook.mjs`), then asserts zero 500s,
zero misrouted/duplicate payments, and consistent key settlement across the
rotation boundary. See [`load/README.md`](../../load/README.md#agent-key-rotation-load-test)
for the exact command and required environment. A failing run refutes the
zero-downtime claim in this runbook and should be treated as a signer-cache
regression, not a flaky load test.

## Full restart (alternative)

If zero-downtime is not required:

```bash
# Update .env or secret manager, then restart
systemctl restart careguard-agent   # or your equivalent
```

## Verification after rotation

1. Confirm the agent logs show the new public key on startup (`Signer key validated for configured network`).
2. Make a test x402 API call (e.g., compare pharmacy prices) and verify it settles on Stellar with the new key's account.
3. Check Stellar testnet/mainnet explorer to confirm the payment was signed by the new account.

## Notes

- The 60-second TTL means that without SIGHUP, the old signer is used for up to 60 seconds after environment rotation.
- SIGHUP is not forwarded by all process managers. Verify your deployment supports it or use a full restart.
- `AGENT_SECRET_KEY` rotation does **not** rotate the MPP client keypair (`agentKeypair`) — that requires a full restart. The MPP keypair is used only for Soroban authorization, not x402.
