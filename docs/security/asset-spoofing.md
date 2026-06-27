# Stellar Asset Spoofing — USDC Issuer Validation

## Threat Model

Stellar allows any account to issue a token with any name, including "USDC". A wallet can simultaneously hold:

- **Canonical USDC** — issued by Circle's official Stellar account (issuer differs per network)
- **Phishing USDC** — a copycat token issued by a malicious account, also named "USDC"

If balance lookups match only on `asset_code === 'USDC'`, they find whichever entry appears first in the Horizon response. A wallet that holds a phishing USDC token alongside real USDC could:

1. Return the wrong balance (inflated or deflated)
2. In payment paths, construct a transaction referencing the wrong asset

## Mitigations

### 1. Dual-key balance lookup (`agent/tools.ts`)

`getWalletBalance()` filters balances by **both** `asset_code` and `asset_issuer`:

```typescript
const usdcBalance = account.balances.find(
  (b: any) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER,
);
```

A balance entry that matches on name but not issuer is treated as if USDC is absent (`usdcTrustlineMissing: true`, balance `'0.00'`).

### 2. Boot guard on public network (`agent/tools.ts`)

On `STELLAR_NETWORK=public`, `USDC_ISSUER` must be explicitly set in the environment. The process refuses to start otherwise:

```
Error: USDC_ISSUER env var must be explicitly set when STELLAR_NETWORK=public.
       Set it to the Circle USDC issuer for Stellar mainnet.
```

This prevents silently using the testnet default issuer address on mainnet (the two networks have different Circle issuer accounts).

### 3. Asset object in payment operations (`agent/tools.ts`)

Payment operations construct the USDC `Asset` object using the same `USDC_ISSUER` constant, so the signed Stellar transaction references the correct on-chain asset.

## Issuer Addresses

| Network | Circle USDC Issuer |
|---|---|
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Mainnet (public) | Set via `USDC_ISSUER` env var — verify from [circle.com/usdc](https://www.circle.com/en/usdc-multichain-support) |

## Operations Checklist

Before deploying to public network:
- [ ] `USDC_ISSUER` is set in the deployment environment to the correct mainnet Circle issuer
- [ ] Verify the address against Circle's official documentation
- [ ] Run `get_wallet_balance` against a test account to confirm correct USDC balance is returned
