# Switching Stellar Network at Runtime

CareGuard's MPP client is lazy-constructed on first use and cached for 60 seconds (issue #196).
This lets you switch between `testnet` and `public` without a full process restart.

## Procedure

1. Update the environment variable on your host or in your secrets manager:
   ```
   STELLAR_NETWORK=public   # or testnet
   ```

2. Send `SIGHUP` to the running process to invalidate the MPP client cache:
   ```bash
   kill -HUP <PID>
   # or, if using systemd:
   systemctl kill --signal=SIGHUP careguard
   ```

3. The next call to any MPP-dependent tool (`pay_for_medication`) will construct a fresh
   client that reads `STELLAR_NETWORK` from the updated environment.

## Notes

- The cache TTL is 60 seconds. Without a SIGHUP, the old network is used until the TTL expires.
- In production, `STELLAR_NETWORK=public` also requires `OZ_FACILITATOR_API_KEY` to be set —
  the server will refuse to start (or log a warning mid-run) without it.
- The x402 and MPP server-side configs in `server.ts` still read `STELLAR_NETWORK` at startup.
  A full restart is required if those need to change (e.g., changing which Horizon endpoint the
  server listens on for MPP receipts).
- `MULTI_PHARMACY_MODE=true` requires `PHARMACY_2_PUBLIC_KEY` to be set before the server starts.
  Changing this flag always requires a restart.
