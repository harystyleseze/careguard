# Runbook: Agent paused due to low wallet balance

**Symptom**

The dashboard shows a red banner: "Agent paused — low USDC balance" or "Agent paused — low XLM balance". `GET /agent/status` returns:

```json
{ "paused": true, "pausedReason": "low-balance-usdc", "pausedAt": "..." }
```

The agent will reject any `POST /agent/run` with HTTP 409 until resumed.

**What it means**

A scheduled balance check (every 15 min by default) loaded the agent wallet from Horizon, found USDC or XLM below the configured threshold, and auto-paused the agent. This is intended behavior — paying out when the wallet is empty would result in failed Stellar transactions, broken receipts, and unhappy caregivers.

**Triggering thresholds**

| Env var | Default |
|---|---|
| `WALLET_LOW_USDC_THRESHOLD` | `1` (USDC) |
| `WALLET_LOW_XLM_THRESHOLD` | `1` (XLM) |

USDC is checked first; if USDC is below threshold the pause reason is `low-balance-usdc`. Otherwise XLM is checked and the reason is `low-balance-xlm`.

## Resolution steps

1. **Check the wallet on stellar.expert.** Copy the agent address from the dashboard header → "Wallet" tab and open it on https://stellar.expert/explorer/testnet to confirm the on-chain balance.

2. **Fund the wallet.**
   - **USDC (testnet):** https://faucet.circle.com — paste the agent public key, mint USDC. Mint at least 5× the threshold to give the agent runway.
   - **XLM (testnet):** https://laboratory.stellar.org — friendbot, or any testnet faucet.
   - **Mainnet:** transfer from caregiver wallet or buy from an exchange that supports Stellar withdrawals.

3. **Wait for funds to settle (~5s on testnet).**

4. **Run the balance check manually to confirm.**
   ```sh
   npm run wallet:check
   ```
   Expected output: `wallet=GBXXXX... USDC=10.00 (≥1) XLM=5.00 (≥1) → OK` (or `agent already paused`).

5. **Resume the agent.**
   - Click "Resume agent" in the red banner on the dashboard, **or**
   - `curl -X POST $AGENT_URL/agent/resume`

6. **Verify in the audit log.** Each auto-pause and resume is appended to `data/audit.log.jsonl`:
   ```sh
   tail -3 data/audit.log.jsonl | jq .
   ```

## Disabling the in-process scheduler

The scheduler is opt-in. It runs only when `WALLET_BALANCE_CHECK_ENABLED=1` is set in the server's environment.

To disable temporarily (e.g. during testing), unset the env var and restart the server. To re-enable, set it back and restart. The schedule itself is configurable via `WALLET_BALANCE_CHECK_CRON` (default `*/15 * * * *`).

For multi-process deploys (cron container separate from app container), leave `WALLET_BALANCE_CHECK_ENABLED=0` and run `npm run wallet:check` from cron in the app container — the script and the in-process scheduler call the same `checkWalletBalance` function.

## Notifications

When the agent auto-pauses, `notify()` writes a `[CRITICAL]` line to stdout. If `SLACK_WEBHOOK_URL` is set, the same message is posted to Slack. There is no email channel today (#71 will add one).

## False positives

If the balance check is firing too often (e.g. you keep getting paused right after resuming), reasons in priority order:

1. **Threshold too aggressive.** `WALLET_LOW_USDC_THRESHOLD=1` means a single ~$1 medication payment can drop you under the line. Raise the threshold or fund more aggressively.
2. **Horizon flake.** If Horizon returns wrong balances or times out, the script returns `error` and **does not** pause. So this should not be a source of false positives — but if it is, file an issue and capture `data/audit.log.jsonl`.
3. **State drift between cron and server.** The pause flip is in-process. If you run the script from cron in a *different* container than the server, the server won't pick up the pause. Use `WALLET_BALANCE_CHECK_ENABLED=1` instead.

## Related

- Issue [#107](https://github.com/harystyleseze/careguard/issues/107) — original spec
- Issue [#71](https://github.com/harystyleseze/careguard/issues/71) — full notification service (Slack/email)
- Issue [#72](https://github.com/harystyleseze/careguard/issues/72) — durable audit log
- `shared/wallet-balance.ts` — implementation
- `scripts/check-wallet-balance.ts` — CLI runner
