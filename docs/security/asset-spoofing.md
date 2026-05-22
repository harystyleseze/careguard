# Stellar Asset Spoofing Guardrail

CareGuard treats Stellar asset issuer identity as part of the payment safety boundary.

On Stellar, `asset_code` is not globally unique. A malicious or mistaken issuer can create an asset that also uses the code `USDC`, so wallet balance checks must never trust `asset_code === "USDC"` on its own.

## Required matching rule

Any code that selects a USDC balance must match both fields:

```ts
asset_code === "USDC" && asset_issuer === USDC_ISSUER
```

The canonical issuer comes from `USDC_ISSUER`. Testnet may fall back to the repo's documented Circle testnet issuer, but production/public-network boot requires an explicit `USDC_ISSUER` value so deployment cannot silently trust a default.

## Threat model

If CareGuard matched only `asset_code`, a wallet holding both real Circle USDC and a spoofed `USDC` trustline could display or route against the wrong asset. That can lead to false balance checks, failed payments, or transfers using a non-canonical token.

## Operational checklist

- Set `USDC_ISSUER` in every deployment environment.
- Treat missing `USDC_ISSUER` on `STELLAR_NETWORK=public` as a startup failure.
- Keep tests that include at least two `USDC` balance entries with different issuers.
- When adding new Stellar payment paths, reuse the shared USDC issuer-selection helper instead of open-coding `asset_code` checks.
