# Runbook: Audit Log Tamper Detected

**Impact**

- **Severity**: HIGH
- **Description**: The cryptographic hash chain of the system audit log has been broken. This indicates that one or more historical log entries have been modified, deleted, inserted, or reordered post-hoc.
- **Risk**: Potential unauthorized database/system activity is being obscured, or log data integrity has been compromised.

**Detect**

The automated verify script detects a hash or sequence mismatch in the log file:
```bash
npx tsx scripts/verify-audit-log.ts
```

Output indicators of tampering:
- `Verification Failed at line <LineNumber> (index <Index>):`
- `Expected prevHash: <ExpectedHash>`
- `Actual prevHash:   <ActualHash>`
- `Expected hash: <ExpectedHash>`
- `Actual hash:   <ActualHash>`

**Respond**

1. **Lock Down Log Files**:
   Immediately make a copy of the active `audit.log.jsonl` file and any rotated archives to a secure, read-only location for forensic analysis:
   ```bash
   cp data/audit.log.jsonl data/audit.log.jsonl.tampered
   chmod 400 data/audit.log.jsonl.tampered
   ```

2. **Locate Tamper Point**:
   Identify the first index of failure reported by the verification script. The entry at that index (or the entry immediately preceding it) is where the modification took place.

3. **Audit Host System Integrity**:
   - Check system SSH logs (`/var/log/auth.log` or equivalent) for unauthorized access.
   - Inspect active filesystem changes in the `data/` directory.
   - Verify if any database or application processes were restarted or executed by unauthorized users.

4. **Verify Wallet/Blockchain Activity**:
   Cross-reference the transactions listed in the audit logs with the actual on-chain Stellar transaction records for the caregiver/agent wallets to confirm if any unlogged or fraudulent payments occurred.

**Recover**

1. **Restore Log State**:
   Restore the `audit.log.jsonl` from the latest trusted, verified backup (e.g., from secure offsite backups).

2. **Re-Verify Chain**:
   Run the verifier script again to ensure the restored file's hash chain is unbroken:
   ```bash
   npx tsx scripts/verify-audit-log.ts
   ```

3. **Identify & Close Security Gaps**:
   Implement stricter OS-level permissions on the `data/` directory so only the application user process has write access.

---

## Related

- [ADR 008: Append-Only Hash-Chained Audit Log Design](../adr/008-audit-log-hash-chain.md)
- [Quarterly Secret Rotation & Game-Day Schedule](rotate-secrets.md#quarterly-rotation-calendar)

---

## Game-Day Drill

Run this drill **quarterly** in a non-production environment alongside the secret-rotation calendar to keep on-call muscle memory sharp and verify detection tooling.

### Target SLAs

- **Time-to-Detect (TTD)**: ≤ 5 minutes from drill start to identifying the exact broken line/index.
- **Time-to-Lockdown (TTL)**: ≤ 10 minutes from detection to isolating the tampered copy (`chmod 400`) and verifying a clean backup.

### Procedure

1. **Inject a hash-chain break (drill facilitator, non-production only)**:
   ```bash
   npx tsx scripts/drill-audit-tamper.ts
   ```
   This copies `data/audit.log.jsonl` (or generates a synthetic 3-entry chain if absent) into `/tmp/careguard-audit-drill-<timestamp>/audit.log.jsonl` and mutates one entry without updating its `hash`. Never mutate the live `data/audit.log.jsonl`.

2. **Cold detection (on-call engineer — start TTD timer)**:
   Run the verifier against the drill file:
   ```bash
   AUDIT_FILE=/tmp/careguard-audit-drill-<timestamp>/audit.log.jsonl npx tsx scripts/verify-audit-log.ts
   ```
   Confirm exit code is `1` and output matches the documented **Detect** indicators:
   - `Verification Failed at line <LineNumber> (index <Index>):`
   - `  Expected hash: <ExpectedHash>`
   - `  Actual hash:   <ActualHash>`
   Record **TTD**.

3. **Simulated lockdown & recovery (start TTL timer)**:
   ```bash
   cp /tmp/careguard-audit-drill-<timestamp>/audit.log.jsonl /tmp/careguard-audit-drill-<timestamp>/audit.log.jsonl.tampered
   chmod 400 /tmp/careguard-audit-drill-<timestamp>/audit.log.jsonl.tampered
   ```
   Identify the tampered line, simulate restoring from a clean backup, and re-run `scripts/verify-audit-log.ts` to confirm `Audit log successfully verified.` (exit code `0`). Record **TTL**.

### Drill Scorecard & Follow-up Issues

| Field | Value |
|---|---|
| Date / Facilitator / On-call | |
| TTD (Target ≤ 5m) | |
| TTL (Target ≤ 10m) | |
| Output matched runbook? (Y/N) | |
| Follow-up issues filed (false positives, unclear output, missing tooling) | |

Log any false positives, unclear verifier output, or missing tooling as GitHub issues before closing the drill.
