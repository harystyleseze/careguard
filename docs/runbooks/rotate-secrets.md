# Runbook: Rotate every secret

Rotate secrets **at least quarterly**, and immediately whenever a key is suspected or confirmed to be compromised.

---

## 1. Agent wallet (`AGENT_SECRET_KEY` / `AGENT_PUBLIC_KEY`)

The agent wallet signs every Stellar transaction. If this key leaks, an attacker can drain all USDC and XLM from the wallet.

**Automated rotation script:**

```sh
# Dry run — shows what would happen (no transactions broadcast)
npx tsx scripts/rotate-agent-wallet.ts

# Execute rotation on the configured network (STELLAR_NETWORK env)
npx tsx scripts/rotate-agent-wallet.ts --execute
```

**What the script does:**
1. Reads current `AGENT_SECRET_KEY` from env and derives the old public key.
2. Generates a new Stellar keypair (`Keypair.random()`).
3. Funds the new wallet: sends XLM (base reserve + fee buffer) from old → new.
4. Sweeps USDC: moves all USDC from old → new.
5. Prints the new key pair and the exact `.env` / Render env-var lines to update.

**After the script completes:**
1. Update `AGENT_SECRET_KEY` and `AGENT_PUBLIC_KEY` in your `.env` file or Render dashboard.
2. Restart the server.
3. Verify the dashboard shows the new wallet address and correct balance.

---

## 2. OZ Facilitator API key (`OZ_FACILITATOR_API_KEY`)

The OZ API key authorises x402 payment facilitation (one key per environment).

**Steps:**
1. Go to [https://channels.openzeppelin.com/testnet/gen](https://channels.openzeppelin.com/testnet/gen) (testnet) or the production console (mainnet).
2. Generate a new API key.
3. Update `OZ_FACILITATOR_API_KEY` in `.env` / Render.
4. Restart the server — x402 payments require the new key immediately on the next request.
5. Revoke the old key in the OZ console.

---

## 3. LLM API key (`LLM_API_KEY`)

Used to authenticate every call to the LLM provider (Groq, OpenRouter, OpenAI, etc.).

**Steps:**
1. Log in to your LLM provider's console.
   - Groq: [https://console.groq.com/keys](https://console.groq.com/keys)
   - OpenAI: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - OpenRouter: [https://openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
2. Create a new API key with the same permissions as the old one.
3. Update `LLM_API_KEY` in `.env` / Render.
4. Restart the server.
5. Revoke the old key in the provider's console.

---

## 4. MPP secret key (`MPP_SECRET_KEY`)

Signs MPP credential tokens used for pharmacy payment authorisation. A leaked key lets attackers forge payment credentials.

**Steps:**
1. Generate a new 256-bit secret:
   ```sh
   openssl rand -hex 32
   ```
2. Update `MPP_SECRET_KEY` in `.env` / Render.
3. Restart the server — the new key takes effect immediately for new payment sessions.

> Note: in-flight MPP sessions signed with the old key will fail. Ensure no orders are mid-flight before rotating (check `/pharmacy/orders`).

---

## 5. JWT refresh secret (when auth lands in #10)

Once user authentication is implemented, JWT signing keys must be rotated with a **dual-verify window** to avoid rejecting valid sessions mid-flight.

**Rotation procedure:**
1. Generate a new JWT secret: `openssl rand -hex 64`
2. Update your config to **accept both old and new** secrets for verification (dual-verify window).
3. Deploy and wait for one access-token TTL (default: 15 minutes) — all previously issued tokens will have expired.
4. Remove the old secret from the config.
5. Deploy again.

This ensures users are not logged out mid-session.

---

## Quarterly rotation calendar

Schedule the following in your team's calendar every 3 months:

| Secret | Action |
|--------|--------|
| Agent wallet | Run `scripts/rotate-agent-wallet.ts --execute` |
| OZ API key | Regenerate in OZ console |
| LLM API key | Regenerate in provider console |
| MPP_SECRET_KEY | `openssl rand -hex 32` and update env |
| JWT secret (once #10 lands) | Dual-verify rotation |

**Suggested calendar entry:** `CareGuard secret rotation — Q[1/2/3/4]`

Set a recurring reminder every 90 days. After each rotation, append a dated entry to `data/audit.log.jsonl` manually or via the admin API for compliance tracking.

---

## Related

- Issue [#95](https://github.com/harystyleseze/careguard/issues/95) — original spec
- Issue [#10](https://github.com/harystyleseze/careguard/issues/10) — auth (JWT)
- `scripts/rotate-agent-wallet.ts` — automation for agent wallet rotation
- `docs/runbooks/wallet-low.md` — what to do when the wallet balance is low
- `docs/SECURITY.md` — full security overview
