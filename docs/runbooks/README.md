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
- `CONTRIBUTING.md` — how to add a new runbook
- `README.md` — project overview
