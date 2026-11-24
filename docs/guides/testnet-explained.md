# CareGuard is currently running on Stellar testnet

CareGuard is designed for real-world caregiving workflows, but it currently operates on the Stellar testnet rather than the live Stellar network.

This is intentional and important for safety:

- No real money is being moved in the default setup.
- The agent uses testnet USDC and testnet XLM, which are not redeemable for cash.
- The app is designed to behave like a real payment system, but every transaction is isolated to testnet.

## What this means for a caregiver

The system is still checking real payment logic, real transaction flows, and real spending limits — but it is not spending actual funds.

That means:

- Your daily and monthly limits are being enforced in the same way they would be in production.
- The agent can still compare prices, detect overcharges, and block risky payments.
- The money involved is testnet money only, so mistakes do not cost real money.

## How to verify a transaction is on testnet

Every payment created by the agent should be visible on the Stellar testnet explorer:

- Open [stellar.expert](https://stellar.expert/explorer/testnet)
- Search for the transaction hash shown in the app's Activity tab
- Confirm the network is listed as `Testnet`

You can also check the agent wallet on the explorer and look for `USDC` balances on the testnet network.

## Why this is the default for CareGuard

CareGuard is a financial workflow tool for sensitive decisions about healthcare spending. Testnet is the safest way to:

- demo the product without real financial risk
- validate payment flows and policy enforcement
- let caregivers understand the workflow before any live deployment

## Safety reminder

If you are reviewing a transaction and wondering whether real money was used, the answer is: not in the default setup.

CareGuard is currently in testnet mode for safety and validation. Any production rollout would require a separate configuration and a verified funding model before real funds are used.

## Related reading

- [README.md](../../README.md)
- [docs/guides/faq.md](faq.md)
- [docs/SPENDING-POLICY.md](../SPENDING-POLICY.md)
