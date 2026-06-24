# Critical Dependencies — Payment Path

These packages sit on the payment execution path. A supply-chain compromise in any of them could result in direct financial loss (USDC transfers to attacker-controlled addresses, interception of payment credentials, or silent payment failures).

## Payment-Path Packages

| Package | Role | Risk |
|---------|------|------|
| `@x402/core` | x402 payment protocol primitives | Tampered library could forge payment headers |
| `@x402/express` | Express middleware for x402 payment verification | Could bypass payment verification |
| `@x402/fetch` | Fetch wrapper that auto-pays x402 challenges | Could redirect payments to attacker address |
| `@x402/stellar` | Stellar-specific x402 scheme | Could forge Stellar authorization signatures |
| `@stellar/stellar-sdk` | Stellar blockchain SDK | Could tamper with transaction construction or signing |
| `@stellar/mpp` | Machine Payments Protocol | Could intercept or modify pharmacy payment transfers |
| `mppx` | MPP server/client utilities | Could alter payment amounts or destinations |

## Monitoring

These packages are reviewed weekly by `.github/workflows/sensitive-deps.yml`:
- Any new version triggers a CI failure requiring a human-reviewed PR before upgrading
- `npm audit` runs on every push (`.github/workflows/ci.yml`) and fails on high/critical CVEs
- A CycloneDX SBOM (`sbom.cdx.json`) is generated on every build and stored as a CI artifact

## CVE Response Runbook

### 1. Detection
- Automated: `npm audit` in CI fails with a high/critical advisory
- Manual: GitHub Security Advisory, Dependabot alert, or vendor notification

### 2. Immediate triage (within 1 hour)
- Identify which payment-path package is affected
- Assess exploitability: is the vulnerable code path reachable in production?
- Check if a patched version is already available

### 3. Freeze auto-merge
- If Dependabot proposes an upgrade for this package, **do not** let it auto-merge
- Add the `security-review-required` label to block `dependabot-automerge.yml`

### 4. Emergency patch PR
- Pin to the patched version (or the lowest unaffected version)
- Require at least two reviewers with Stellar/x402 payment expertise
- Include diff of relevant upstream changes, especially in payment-path code

### 5. Testnet validation
- Run the full agent task suite against Stellar testnet
- Verify: pharmacy price query, bill audit, medication order payment, bill payment
- Confirm real USDC transactions settle correctly

### 6. Deploy
- Deploy to production during a low-traffic window
- Monitor Stellar transaction success rate and error logs for 30 minutes post-deploy

### 7. Post-mortem
- Document: package affected, CVE number, time to detection, time to patch, any production impact
- Update this runbook if the response process exposed gaps
