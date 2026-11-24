# Game-Day Drill #961: Leaked-Secret Tabletop & Testnet Containment

> **Issue:** [#961](https://github.com/harystyleseze/careguard/issues/961)  
> **Runbook:** [docs/runbooks/leaked-secret.md](../runbooks/leaked-secret.md) · [docs/runbooks/rotate-secrets.md](../runbooks/rotate-secrets.md)  
> **Target Environment:** **Stellar Testnet Only** (never run against mainnet or real secrets)

## Objective

Rehearse the leaked-secret response in [leaked-secret.md](../runbooks/leaked-secret.md) under time pressure without touching real funds or production credentials:

1. Simulate discovering a leaked `AGENT_SECRET_KEY` (using a **disposable Stellar testnet keypair**) and a leaked API key.
2. Execute wallet creation, fund transfer (sweep), and `.env` update steps from the runbook against Stellar testnet.
3. Separately rehearse API-key revoke/regenerate steps in a sandboxed/non-production provider console where available.
4. Measure **Time-to-Containment (TTC)** against the agreed target (**≤ 10 minutes / 600 s** for Stellar keypair containment; **≤ 15 minutes / 900 s** total).
5. Record all gaps (missing automation, unclear steps) and file follow-up issues.

> [!CAUTION]
> **Safety Guardrail:** This drill MUST only use a freshly generated, disposable Stellar **testnet** keypair (`STELLAR_NETWORK=testnet`). Never use a production/mainnet `AGENT_SECRET_KEY` or real funds.

---

## Pre-Drill Setup (Before Timer Starts)

1. Generate and fund a disposable testnet wallet and a disposable `.env.drill` file (never touch production `.env`):
   ```bash
   node --import tsx scripts/drills/drill-leaked-secret.ts --setup --env-file .env.drill
   ```
   This creates a fresh testnet `Keypair.random()`, funds it via Stellar Testnet Friendbot, and writes `.env.drill` with `STELLAR_NETWORK=testnet`.
2. Confirm `scripts/rotate-agent-wallet.ts` is available for the fund-sweep step.
3. Confirm access to at least one sandboxed/test developer console (e.g. Groq `console.groq.com`, OpenAI `platform.openai.com`, or OpenZeppelin `channels.openzeppelin.com`) with a disposable test API key ready to revoke.
4. Agree on the Time-to-Containment targets:
   - **Stellar keypair containment target:** ≤ 10 minutes (`600 s`)
   - **Total containment target (Stellar + API keys):** ≤ 15 minutes (`900 s`)

---

## Procedure

### T0 — Incident Injection

Facilitator announces: *"A secret `AGENT_SECRET_KEY` (`S...`) and a test provider API key were just spotted in a recent commit."*  
Record `T0` (UTC timestamp). Start the containment timer.

---

### Part A — Stellar Secret Seed (`AGENT_SECRET_KEY`) Containment (Testnet)

1. **Dry-run the rotation plan** using `.env.drill`:
   ```bash
   DOTENV_CONFIG_PATH=.env.drill STELLAR_NETWORK=testnet \
     node --import tsx scripts/rotate-agent-wallet.ts --dry-run
   ```
2. **Execute wallet creation & fund sweep** on Stellar testnet:
   ```bash
   DOTENV_CONFIG_PATH=.env.drill STELLAR_NETWORK=testnet \
     node --import tsx scripts/rotate-agent-wallet.ts --execute
   ```
3. **Update `.env.drill`** with the newly printed `AGENT_SECRET_KEY` and `AGENT_PUBLIC_KEY` values.
4. **Verify containment** on Horizon testnet:
   ```bash
   node --import tsx scripts/drills/drill-leaked-secret.ts \
     --verify \
     --old-public <COMPROMISED_PUBLIC_KEY> \
     --new-public <NEW_PUBLIC_KEY>
   ```
   Confirm the new wallet holds the swept balance and the compromised wallet is drained down to reserve.
5. **Check Soroban / multisig authorizations** (tabletop check): confirm whether the compromised wallet held any Soroban approvals or multisig signers that must be re-established on the new wallet.
6. Record `T_stellar` (UTC).

---

### Part B — Sandboxed API-Key Revoke & Regenerate

For each available sandboxed provider console (Groq, OpenAI, OpenZeppelin, MPP):

1. Log in to the provider's developer console (sandboxed/test project).
2. Locate the simulated leaked test API key and **revoke/delete** it.
3. **Generate** a new test API key.
4. Update the corresponding variable in `.env.drill`.
5. Confirm the revoked key is rejected (`401 Unauthorized`) and the new key succeeds.
6. Record `T_api` (UTC).

---

### Part C — Git History Purge (Tabletop Walkthrough)

Review Section 3 of `docs/runbooks/leaked-secret.md` (`bfg` / `git-filter-repo` + `git reflog expire` + `git gc`). Confirm the team knows when a history purge is required (public repo exposure) and that it does **not** replace immediate key revocation. *(Do not force-push any shared branch during the drill.)*

---

## Time-to-Containment & Gap Analysis

| Metric | Recorded Value | Target | Pass / Fail |
|---|---|---|---|
| `T0` Incident injected (UTC) | | — | — |
| `T_stellar` Stellar sweep + `.env` updated (UTC) | | — | — |
| `TTC_stellar` (`T_stellar - T0`) | | ≤ 600 s (10 min) | |
| `T_api` API keys revoked & regenerated (UTC) | | — | — |
| `TTC_total` (`max(T_stellar, T_api) - T0`) | | ≤ 900 s (15 min) | |

### Known Gaps to Verify & File as Follow-Up Issues

| Area | Observed Gap | Follow-up Issue |
|---|---|---|
| `scripts/rotate-agent-wallet.ts` | Leaves `2.5 XLM` base reserve in the compromised wallet rather than performing an `accountMerge` to drain 100% of XLM. | |
| `.env` update step | Requires manual copy-paste of `AGENT_SECRET_KEY` and `AGENT_PUBLIC_KEY` from stdout under time pressure. | |
| `docs/runbooks/leaked-secret.md` | Broken local Windows file link (`file:///c:/Users/HP/.../rotate-secrets.md`) on line 9. | |
| API-key revocation | No automated check verifying revoked keys return `401` across providers. | |

---

## Execution Log Template

| Field | Value |
|---|---|
| Drill Date (UTC) | |
| Facilitator / Participants | |
| Disposable Compromised Public Key (Testnet) | |
| New Testnet Public Key | |
| Sandboxed Provider Consoles Rehearsed | |
| `TTC_stellar` (s) | |
| `TTC_total` (s) | |
| Gaps Discovered | |
| Follow-Up Issues Filed | |

---

## Acceptance Criteria Mapping

- [ ] Drill uses a disposable testnet Stellar keypair, never a real/production secret
- [ ] Team executes wallet creation, fund transfer, and `.env` update steps from the runbook against testnet
- [ ] Drill separately rehearses API-key revoke/regenerate steps for a sandboxed provider console where available
- [ ] Time-to-containment is measured and compared against an agreed target
- [ ] Gaps (missing automation, unclear steps) are filed as follow-up issues
