# MPP Charge Service — Persistence Model

## Overview

The Pharmacy Payment service accepts medication order payments via MPP (Machine Payments Protocol) charge mode on Stellar. Each payment settles as a USDC transfer on Stellar testnet.

## Payment Flow

```
Client POST /pharmacy/order
       │
       ▼
  Mppx.charge()  ──── no prior challenge ────►  402 response with X-Payment-Challenge header
       │                                          (challenge state written to mpp-store.json)
       │
       │◄── Client signs Soroban auth entry, re-POSTs with X-Payment-Authorization header
       │
  Mppx.charge()  ──── valid auth found ────────►  Server broadcasts USDC transfer on Stellar
       │                                           (challenge state removed from mpp-store.json)
       ▼
  Order saved to orders.json  ──────────────────►  200 response with order confirmation
```

## Persistence

### MPP Challenge State (`data/mpp-store.json`)

`Mppx` is configured with `Store.fileSystem(path)` so that in-flight payment challenge state
(the mapping from challenge nonce → expected payment details) survives a process restart.

**Without persistence:** A crash between step 1 (402 issued) and step 2 (client re-POST) would lose
the challenge state. When the process restarts and the client re-POSTs with the signed authorization,
`Mppx.charge()` finds no matching challenge and the payment fails.

**With persistence:** The challenge state is written to `data/mpp-store.json` atomically. On restart,
`Mppx` reloads the state and can validate the re-POSTed authorization correctly.

### Order Records (`data/orders.json`)

Confirmed orders are written to `data/orders.json` using atomic temp-file + rename writes, protected
by `proper-lockfile` to prevent race conditions under concurrent requests.

## Trade-offs

| Approach | Durability | Throughput | Complexity |
|---|---|---|---|
| `Store.memory()` | None — lost on restart | Highest | Lowest |
| `Store.fileSystem()` (current) | Survives restarts | Adequate for demo | Low |
| SQLite | Survives restarts + concurrent instances | High | Medium |
| Redis | Survives restarts + horizontal scale | Highest | High |

For production at scale, consider migrating to SQLite (see [Issue #168]) or a Redis-backed store.
