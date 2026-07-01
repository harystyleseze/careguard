# Stellar Transaction Lifecycle

## Overview

CareGuard submits Stellar transactions (USDC payments, x402 payments, MPP charges) to the Stellar testnet. This doc describes the lifecycle of a transaction and how timeouts/retries are handled.

## Timebounds

Every Stellar transaction has a **timebound** — a window of time during which the transaction can be included in a ledger. If the transaction is not included before the timebound expires, it is rejected with `tx_too_late`.

The timebound duration is controlled by the `STELLAR_TIMEBOUNDS_SECONDS` environment variable:

```
# Default: 60 seconds
STELLAR_TIMEBOUNDS_SECONDS=60
```

A higher value (e.g., 120) protects against testnet congestion but delays detection of truly failed transactions.

## Retry on `tx_too_late`

When a transaction is rejected with `tx_too_late`, the agent performs one retry with **fresh timebounds**:

1. A new transaction is built (same operations, new sequence number via `loadAccount`)
2. Signed with the agent keypair
3. Resubmitted to Horizon

This is handled by the `submitTransactionWithRetry` function in `agent/tools.ts`. The rebuild callback (`rebuildTx`) reconstructs the transaction with a fresh timebound window.

For non-expiration errors (`tx_bad_seq`, `tx_too_early`), the transaction is not retried — these indicate a fundamental issue.

## Flow

```
  ┌────────────────────┐
  │ Build transaction  │
  │ .setTimeout(SECS)  │
  └────────┬───────────┘
           │
           ▼
  ┌────────────────────┐
  │ Sign with keypair  │
  └────────┬───────────┘
           │
           ▼
  ┌────────────────────┐
  │ Submit to Horizon  │◄──── retry loop (max 2)
  └────────┬───────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  success     tx_too_late
                  │
                  ▼
        ┌────────────────────┐
        │ Rebuild with fresh │
        │ timebounds, resign │
        └────────┬───────────┘
                 │
                 ▼
        ┌────────────────────┐
        │ Resubmit (once)    │
        └────────────────────┘
```

## Related

- `agent/tools.ts` — `submitTransactionWithRetry`, `payBill`
- `STELLAR_TIMEBOUNDS_SECONDS` env var
