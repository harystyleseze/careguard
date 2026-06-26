# Runbook: Leaked Secret

**Symptom**

Gitleaks fails in CI, a local pre-commit hook blocks a commit, or a maintainer reports that a Stellar seed/API key appears in git history.

**Impact**

Treat every leaked `AGENT_SECRET_KEY`, `OZ_FACILITATOR_API_KEY`, `LLM_API_KEY`, `MPP_SECRET_KEY`, and Stellar `S...` seed as compromised. An exposed agent wallet can authorize payments; exposed API keys can incur provider cost or let an attacker impersonate the service.

**Diagnosis**

1. Open the failed Secret Scan job and identify the rule id, file path, and commit SHA.
2. Confirm whether the value is a real secret or one of the test-only fake keys allowlisted in `.gitleaks.toml`.
3. Search the branch for additional copies:

```sh
gitleaks detect --source . --config .gitleaks.toml --redact --verbose
```

4. Check whether the leaked commit reached `main` or only exists on an unmerged branch.

**Mitigation**

1. Revoke or rotate the exposed credential immediately. Do not wait for a code cleanup PR.
2. If a Stellar secret seed leaked, move funds to a newly generated wallet and update the matching public key.
3. Disable affected deploys or pause agent payment actions if the leaked key could authorize spending.
4. Notify maintainers in the incident channel with the affected secret type, first bad commit, and rotation status. Do not paste the secret value.

**Remediation**

1. Remove the secret from code, docs, logs, fixtures, and generated artifacts.
2. Replace real-looking fixtures with deterministic fake placeholders or generated-at-test-runtime values.
3. Run the local scanner:

```sh
gitleaks detect --source . --config .gitleaks.toml --redact --verbose
```

4. If the secret reached a shared branch, coordinate a history rewrite with maintainers using `git filter-repo` or GitHub secret-scanning remediation guidance.
5. After history cleanup, force all contributors to re-clone or hard-reset from the cleaned branch.

**Post-mortem template**

- Date / duration:
- Secret type:
- First bad commit:
- Where it propagated:
- Detection source:
- Rotation completed at:
- History cleanup required:
- Action items:
