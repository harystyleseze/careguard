# CareGuard Runbooks

Operational runbooks for on-call engineers. Each runbook follows the template:
**Symptom → Impact → Diagnosis → Mitigation → Remediation → Post-mortem template**

---

## Index

| Runbook | Summary |
|---------|---------|
| [rotate-secrets.md](rotate-secrets.md) | Quarterly and emergency rotation of all secrets (agent wallet, OZ API key, LLM key, MPP secret) |
| [wallet-low.md](wallet-low.md) | Agent auto-paused due to low USDC or XLM balance — how to fund and resume |
| [csp-changes.md](csp-changes.md) | Content-Security-Policy changes — how to update without breaking the dashboard |
| [oz-facilitator-outage.md](oz-facilitator-outage.md) | OZ facilitator unreachable — recognise, communicate, fail-open vs fail-closed decision |
| [llm-rate-limit.md](llm-rate-limit.md) | Groq 429 / LLM provider rate-limit hit — behaviour, provider switching mid-incident |
| [dashboard-disconnected.md](dashboard-disconnected.md) | Dashboard shows "Disconnected" chip — diagnosing API connectivity issues |
| [horizon-down.md](horizon-down.md) | Stellar Horizon outage or testnet congestion — detection, in-doubt settlement verification, fee-bump tuning, recovery |
| [backup-restore.md](backup-restore.md) | Disaster recovery procedure with RTO/RPO targets, backups, step-by-step restore, and integrity checks |

| [rate-limit-tuning.md](rate-limit-tuning.md) | Safely tuning rate-limit env vars, Prometheus metric monitoring (`ratelimit_hits_total`), rollout, and rollback procedures |
| [redis-down.md](redis-down.md) | Redis unavailable — in-process cache fallback, what state degrades (webhook replay protection), and recovery |
| [disk-full.md](disk-full.md) | Disk full / data directory exhaustion — diagnosing largest writers, safe recovery without breaking the audit-log hash chain |
| [grafana-backup.md](grafana-backup.md) | Grafana dashboard state lost after `docker compose down -v` — what's provisioned (survives) vs. UI-only (doesn't), exporting dashboards back into `docker/grafana/dashboards/`, restoring provisioning after a fresh boot |
| [rate-limit-tuning.md](rate-limit-tuning.md) | Tuning `RATE_LIMIT_*` thresholds safely — reading `ratelimit_hits_total`, telling throttling apart from abuse, and rolling out a change without locking out the dashboard |
| [tune-audit-thresholds.md](tune-audit-thresholds.md) | Tuning `BILL_AUDIT_*` multipliers and `BILL_AUDIT_MAX_ITEMS`, plus triaging `bill_audit_oversized_rejections_total` |
| [process-health.md](process-health.md) | Diagnosing Node.js event-loop lag, V8 heap pressure, RSS growth, and GC pause alerts |
| [audit-log-tamper-detected.md](audit-log-tamper-detected.md) | Detecting, locking down, and recovering from a broken audit-log hash chain, plus quarterly game-day drill |

---

## Runbook template

Use this structure when authoring a new runbook:

```markdown
# Runbook: <Title>

**Symptom**
What the on-call engineer or user observes.

**Impact**
Who is affected and how severely.

**Diagnosis**
Commands / log queries / dashboard checks to confirm root cause.

**Mitigation**
Fastest way to reduce customer impact (may not fix the root cause).

**Remediation**
Permanent fix.

**Post-mortem template**
- Date / duration:
- Root cause:
- Detection lag:
- Mitigation taken:
- Remediation:
- Action items:
```

---

## Related

- `docs/adr/` — architectural decision records
- `docs/security/` — security policies and threat model
- [`docs/observability/sentry.md`](../observability/sentry.md) — Sentry setup, redaction, and the escalation path that feeds into these runbooks
- `CONTRIBUTING.md` — how to add a new runbook
- `README.md` — project overview
