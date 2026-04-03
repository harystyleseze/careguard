# CareGuard — Project Context

## What This Is
AI agent for elderly care financial coordination on Stellar. The agent autonomously manages healthcare spending (medication prices, bill auditing, payments) within caregiver-controlled Soroban spending policies.

## Tech Stack
- Runtime: Node.js 20+ with ES modules
- Language: TypeScript (run via tsx)
- Stellar SDK: @stellar/stellar-sdk v14.6.1 (rpc namespace, NOT SorobanRpc)
- Network: Stellar testnet
- Network passphrase: `Test SDF Network ; September 2015`

## Stellar Configuration
- RPC URL: https://soroban-testnet.stellar.org
- Horizon URL: https://horizon-testnet.stellar.org
- USDC issuer (testnet): GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
- USDC SAC (testnet): CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

## Payment Protocols
- x402: per-query payments for API services (@x402/express, @x402/fetch, @x402/stellar)
- MPP charge: one-time payments for medication orders (@stellar/mpp, mppx)
- Facilitator: https://www.x402.org/facilitator

## Key Conventions
- Use `rpc.Server` (not SorobanRpc.Server) — SDK v14 renamed this
- Always simulate before sending Soroban transactions
- sendTransaction returns PENDING — must poll for ledger inclusion
- Testnet USDC has multiple issuers — use the Circle one above
- All services run as separate Express.js processes on different ports
- Shared types live in shared/types.ts

## Project Structure
```
careguard/
├── services/
│   ├── pharmacy-api/    — x402-protected pharmacy price comparison
│   ├── bill-audit-api/  — x402-protected medical bill auditing
│   └── drug-interaction-api/ — x402-protected drug interaction check
├── agent/               — AI agent with Claude API tool-use
├── dashboard/           — Next.js caregiver dashboard
├── shared/              — Shared TypeScript types
├── scripts/             — Setup and utility scripts
└── CLAUDE.md            — This file
```
