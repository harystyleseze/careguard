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
