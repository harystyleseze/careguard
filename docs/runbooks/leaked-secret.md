# Runbook: Handling Leaked Secrets

This runbook details the immediate steps to take if a secret key (such as `AGENT_SECRET_KEY`, `OZ_FACILITATOR_API_KEY`, `LLM_API_KEY`, `MPP_SECRET_KEY`, or any Stellar `S...` secret seed) is committed or otherwise exposed.

## 1. Revoke and Rotate the Secret Immediately

Never try to just delete the commit or push a fix. Once a secret is pushed, it must be considered compromised.

Refer to [docs/runbooks/rotate-secrets.md](file:///c:/Users/HP/Desktop/Blockchain/DripsWave/careguard/docs/runbooks/rotate-secrets.md) for the rotation instructions for each specific key.

## 2. Invalidate the Compromised Keys

### Stellar Secret Seeds (AGENT_SECRET_KEY / Carerecipient wallets)
1. **Move Funds**: Create a new Stellar wallet keypair. Use Horizon or a Stellar wallet client to transfer all remaining USDC and XLM from the compromised wallet to the new wallet.
2. **Update Config**: Replace the compromised secret seed in the environment configuration (`.env`).
3. **Re-authorize**: If the wallet had specific Soroban authorizations or multisig setups, re-establish them on the new wallet.

### API Keys (Groq, OpenAI, OZ Facilitator, MPP)
1. Log in to the respective developer console:
   - Groq: [console.groq.com](https://console.groq.com)
   - OpenAI: [platform.openai.com](https://platform.openai.com)
   - OpenZeppelin: [channels.openzeppelin.com](https://channels.openzeppelin.com)
2. Revoke the compromised API key.
3. Generate a new API key.
4. Update the environment configuration.

## 3. Clean the Git History (Optional but Recommended)

If the secret was committed to a public repository, use `git-filter-repo` or `BFG Repo-Cleaner` to purge the secret from all git history:

```bash
# Example using BFG
bfg --replace-text pattern_matching_compromised_secret.txt
git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push origin --force --all
```
