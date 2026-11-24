# RFC 1458: Make `shared/wallet-balance.ts` the single source of Horizon balance-fetching logic

**Status:** Proposed / Implemented  
**Date:** 2026-08-27  
**Issue:** [#1458](https://github.com/harystyleseze/careguard/issues/1458)  

---

## Context

Horizon USDC/XLM balance-fetching logic was independently duplicated in `agent/server.ts` (`verifyWallet()` and `/agent/wallet` handler) and `shared/wallet-balance.ts` (`fetchWalletBalances`). Inline Horizon account loading (`server.loadAccount(address)` followed by manual balance filtering for `"USDC"` and `"native"`) led to redundant, un-cached code and inconsistent error handling across modules.

This RFC makes `shared/wallet-balance.ts` the mandatory single source for Horizon balance-fetching logic, removes inline copies from `agent/server.ts`, and adds a static CI check to prevent future duplications.

---

## Acceptance Criteria

### 1. Confirm Duplication Scope

- **`shared/wallet-balance.ts`:** Exposes `fetchWalletBalances(address, horizonUrl, usdcIssuer)` returning `BalanceSnapshot` (`{ address, usdc, xlm }`).
- **`agent/server.ts` (duplicated previously):** `verifyWallet()` and `/agent/wallet` independently instantiated `horizonServer.loadAccount(publicKey)` and iterated over `account.balances` manually to find `USDC` and `native` entries.

### 2. Proposal: Delegate All Calls to `shared/wallet-balance.ts`

- Refactor `agent/server.ts` (`verifyWallet()` and `/agent/wallet` route) to call `fetchWalletBalances(address, horizonUrl, usdcIssuer)`.
- Eliminate manual `account.balances.find(...)` calls in `agent/server.ts`.

```ts
// agent/server.ts
const balances = await fetchWalletBalances(
  address,
  STELLAR_CONFIG.horizonUrl,
  process.env.USDC_ISSUER || ""
);
```

### 3. Narrow Static CI Check

Add script `scripts/check-wallet-balance-duplication.ts` that scans all `.ts` files outside `shared/wallet-balance.ts` and `shared/__tests__/` for direct Horizon balance extraction patterns:
- Calling `loadAccount` followed by manual `balances.find` or `asset_code === "USDC"` / `asset_type === "native"` queries.
If found outside `shared/wallet-balance.ts`, the script exits with non-zero status.

### 4. Migration Plan and Regression Test Coverage

- Update `agent/server.ts` to route all balance queries through `shared/wallet-balance.ts`.
- Add test coverage in `shared/__tests__/wallet-balance.test.ts` verifying that `agent/server.ts` uses `fetchWalletBalances` and contains no duplicate inline Horizon balance parsing.

### 5. Generalization to Prevent Future Duplications

This approach establishes a rule for `shared/` abstractions: cross-cutting Stellar domain logic (such as account balance retrieval, payment preparation, or fee calculation) must reside in dedicated `shared/` modules, guarded by narrow static checks in CI.
