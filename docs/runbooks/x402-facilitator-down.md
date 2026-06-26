# Runbook: x402 Facilitator Down

**Impact**

Paid x402 routes fail closed. If facilitator sync fails during boot, the service logs a critical message and exits with code `1`. If the facilitator goes down after boot, paid routes return `503`; unpaid routes continue to serve normally.

**Detect**

- Look for `critical: x402 facilitator startup sync failed; refusing to start` during boot.
- Look for `x402 facilitator health check failed; paid routes will return 503` after boot.
- Confirm paid routes return `503` with `x402 facilitator unavailable`.

**Respond**

1. Check `X402_FACILITATOR_URL` and `OZ_FACILITATOR_API_KEY`.
2. Verify the OpenZeppelin facilitator status.
3. Restart the service only after the facilitator or configuration is healthy.
4. Do not bypass x402 middleware or fail open for paid routes.

**Recover**

When the facilitator is reachable again, the periodic health check marks paid routes healthy and traffic resumes. If the service exited during boot, restart it after the facilitator is available.
