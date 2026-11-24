# RFC 1455: Replace scattered `NETWORK_MODE` checks with a single injected `NetworkConfig` dependency

**Status:** Proposed / Implemented  
**Date:** 2026-08-27  
**Issue:** [#1455](https://github.com/harystyleseze/careguard/issues/1455)  

---

## Context

Network mode logic (testnet vs public, mock mode vs live) was previously scattered across multiple modules (`shared/network-mode.ts`, `shared/stellar-network.ts`, `agent/tools.ts`, and `agent/server.ts`). Each module independently evaluated `process.env.STELLAR_NETWORK` and `process.env.MOCK_NETWORK` at call sites or top-level module load time.

Because network context was not resolved in a single place at process boot, `agent/server.ts` suffered from a known bug in its `GET /` route where `network` was hardcoded to `"stellar:testnet"` regardless of configured environment.

This RFC unifies network resolution into a single `NetworkConfig` dependency object resolved once at process boot and passed/injected across system components.

---

## Acceptance Criteria

### 1. Map Current Call Sites

Prior call sites independently branching on network environment:
- `shared/stellar-network.ts`: `resolveStellarNetwork()` independently read `process.env.STELLAR_NETWORK`.
- `shared/network-mode.ts`: `isMockNetwork(env)` independently read `process.env.MOCK_NETWORK`.
- `agent/tools.ts`: Top-level read of `resolveStellarNetwork()` and `isMockNetwork()`.
- `agent/server.ts`: Top-level read of `resolveStellarNetwork()`, and hardcoded `"stellar:testnet"` response in `GET /`.

### 2. NetworkConfig Type Proposal

Define a comprehensive `NetworkConfig` type in `shared/stellar-network.ts`:
```ts
export interface NetworkConfig {
  networkType: StellarNetworkType;
  horizonUrl: string;
  networkPassphrase: string;
  isMock: boolean;
  networkIdentifier: string; // e.g. "stellar:testnet" or "stellar:public"
}
```

### 3. Resolution at Process Boot and Injected Strategy

Provide `createNetworkConfig(env)` to resolve the full network configuration once at process startup:
```ts
export function createNetworkConfig(env: NodeJS.ProcessEnv = process.env): NetworkConfig {
  const stellarConfig = resolveStellarNetwork(env);
  const mock = isMockNetwork(env);
  assertMockNetworkAllowed(env);
  return {
    ...stellarConfig,
    isMock: mock,
    networkIdentifier: `stellar:${stellarConfig.networkType}`,
  };
}
```

Components (`agent/server.ts`, `server.ts`, `agent/tools.ts`) accept `NetworkConfig` as a context parameter or retrieve the process-boot instance.

### 4. Migration Plan Minimizing Signature Churn

- `resolveStellarNetwork` and `getNetworkConfig` accept optional `env` / `config` parameter, providing backward compatibility while enabling dependency injection for server routes and tools.
- Top-level servers instantiate `const networkConfig = createNetworkConfig(process.env);` once during boot.

### 5. Bug Fix for `agent/server.ts` `GET /`

The `GET /` handler in `agent/server.ts` is updated to reflect the resolved network:
```ts
// before (bug): network: "stellar:testnet"
// after (fixed):
network: STELLAR_CONFIG.networkIdentifier
```
This prevents hardcoding network strings by construction.
