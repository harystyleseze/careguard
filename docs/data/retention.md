# Data Retention Policy

CareGuard persists spending records, medication order history, and an
append-only audit log containing health-adjacent data, with no previously
documented retention or deletion policy. This doc defines how long each data
class is kept, how a data subject's data is deleted on request, and the
HIPAA/GDPR considerations that apply — including the gap called out in
[`docs/SECURITY.md`](../SECURITY.md#97--phi-scrubbing-for-llm-providers):
PHI scrubbing (`shared/prompt-scrub.ts`) only pseudonymises names in text sent
to the LLM provider. It does nothing for data already written to disk — this
doc is about *that* data.

For the underlying file layout, see [`docs/data/storage.md`](./storage.md).
For the PII risk this policy formalises a response to, see
[ADR 002](../adr/002-pii-in-persistence.md).

---

## Data classes and retention periods

| Data class | Where it lives | Contains | PHI/PII? | Routine retention |
|---|---|---|---|---|
| **Spending records** | `data/recipients/{id}/spending.json`, `spending.snapshot.json` | Live/compacted USDC spend totals by category, transaction list, tx hashes | Yes — spending pattern is PHI-adjacent (reveals treatment cost/frequency); wallet addresses are PII | For the life of the active caregiver–recipient relationship. Deleted within 30 days of offboarding or an erasure request (see below). |
| **Orders** | `data/recipients/{id}/orders.json`, `transactions.jsonl` | Medication names, pharmacy names, dollar amounts, timestamps, recipient wallet addresses | Yes — medication names are PHI; wallet addresses are PII | Same as spending records — they're written by the same save path (`saveSpending`/`appendTransaction` in `agent/tools.ts`) and share its lifecycle. |
| **Care recipient profile** *(not named in the issue, included for completeness — see note below)* | `data/careguard.sqlite`, `care_recipients` table | Name, age, medication list, primary doctor, insurance — via `services/care-recipients/db.ts` | Yes — this is the single most sensitive PHI store in the system | Same as spending records: life of the relationship, deleted within 30 days of offboarding/erasure. |
| **Audit log** | `data/audit.log.jsonl` (+ rotated archives `.1`–`.12`) | Every suspicious task, policy violation, cap breach, and (per `docs/runbooks/rotate-secrets.md`) secret-rotation event — actor, event type, and a `details` object that can include recipient-identifying context | Yes, via `details` | **Policy target: 6 years** from creation, aligned with HIPAA's documentation-retention rule for security-incident records (45 CFR § 164.316(b)(2)(i) — see "HIPAA/GDPR obligations" below). **Not currently enforced by the code** — see the note directly below the table. Not deleted on a routine schedule otherwise; see "Tension with the append-only chain" below for how erasure requests are actually handled. |
| **Application logs** | stdout only (`shared/logger.ts`, pino) — CareGuard does not write logs to a file or `data/` itself | Request IDs, agent run IDs, HTTP metadata; secrets and Stellar seeds are redacted at the logger level (`redact.paths`, `STELLAR_KEY_RE`) but request bodies/task text are not fully scrubbed (`task` is truncated to 100 chars, not redacted) | Possibly — truncated task text could contain a name before PHI scrubbing runs | **Not controlled by this application.** Retention is whatever the hosting platform provides. On Render (this repo's actual deploy target — see `render.yaml`, `Dockerfile`), retention is **7 / 14 / 30 days** depending on the *workspace's* billing plan (Hobby / Professional / Organization) — a setting outside this repo, not the `plan: free` service tier in `render.yaml`. If log retention beyond that window is required for compliance evidence, stream to an external log sink; this repo does not do so today (the same "no backup process today" gap already documented for metrics in [`docs/observability/prometheus-retention.md`](../observability/prometheus-retention.md)). |

**Why "care recipient profile" is included even though the issue names only
"spending, orders, audit log, logs":** `data/careguard.sqlite` didn't exist
yet when [ADR 002](../adr/002-pii-in-persistence.md) was written, and it
holds a full medication list, doctor, and insurance record — omitting the
most sensitive PHI table in the system from a document specifically about
PHI retention would leave a real, material gap. It's called out explicitly
here rather than silently folded into "spending records" or silently
dropped.

**The audit log's 6-year target is not actually enforced by the current
code, and this is a real gap, not a rounding error.** `shared/audit-log.ts`'s
`rotateLogs()` triggers purely on file size — `MAX_FILE_SIZE = 10MB` — and
once more than `MAX_ARCHIVES = 12` rotated files accumulate, the oldest is
permanently deleted via `unlinkSync`, unconditionally. There is no date
check anywhere in that function; retention is bounded by **write volume**
(roughly 130 MB total across the live file plus 12 archives), not by a
clock. Under low audit-event volume this comfortably exceeds 6 years; under
high volume (many suspicious tasks, policy violations, or secret rotations
logged per day) it could silently fall well short of 6 years, with no
alert when it happens. **This document states the policy target the code
should be changed to meet — closing the gap (e.g. a date check in
`rotateLogs()`, or archiving to colder storage before deletion instead of
`unlinkSync`) is new code, out of scope for this documentation-only issue,
and is flagged here so it isn't mistaken for already being true.**

**Why 30 days for spending/orders/profile data**: this isn't an arbitrary
number — it mirrors GDPR Article 12(3)'s own "without undue delay and in any
event within one month" deadline for acting on a data-subject request, so
routine offboarding and on-demand erasure use the same, single window rather
than two different policies to remember.

---

## Data-subject erasure/deletion procedure

There is currently no automated deletion endpoint — `services/care-recipients/routes.ts`
exposes only `GET /recipients` and `POST /recipients`, no `DELETE`. Until one
exists, erasure is a manual, operator-run procedure:

1. **Identify the recipient ID** (e.g. `rosa`) and confirm the requester is
   authorized to request erasure for that recipient (the caregiver, or the
   recipient themselves once auth lands — issue #10).
2. **Delete the recipient's directory**: `rm -rf data/recipients/<id>/` —
   removes `spending.json`, `transactions.jsonl`, `spending.snapshot.json`,
   `orders.json`, and `policy.json` together, since they share one directory
   by design (`getRecipientDir()` in `agent/tools.ts`).
3. **Delete the care-recipient profile row**: `DELETE FROM care_recipients
   WHERE id = '<id>'` against `data/careguard.sqlite` (no ORM/migration
   layer exists yet — see `services/care-recipients/db.ts`).
4. **Do not delete matching audit log entries** — see the next section for
   why, and what to do instead.
5. **Record the erasure itself** as a new audit log entry
   (`appendAuditEntry({ event: "data_subject_erasure", actor: "<operator>",
   details: { recipientId: "<id>" } })`) so there's a durable record that the
   request was honored, without the deleted data itself appearing in it.
6. **Respond to the requester within one month** of the original request,
   per GDPR Article 12(3) (extendable by two further months for a complex
   or high-volume request, with the requester notified of the extension).

### Tension with the append-only audit chain

`shared/audit-log.ts` hash-chains every entry: each line's `hash` is
`sha256(prevHash + canonicalize(payload))`, where `payload` includes the
entry's `details` object. This was verified directly against the source, not
assumed — `appendAuditEntry()` computes `prevHash` from the literal previous
line via `getLastLine()`, and `docs/runbooks/audit-log-tamper-detected.md`
treats **any** post-hoc change to a historical entry — modification,
deletion, or reordering — as a tamper event, with no built-in distinction
between malicious tampering and a lawful erasure request:

- **Deleting a line** invalidates every subsequent entry's `prevHash`/`hash`
  chain from that point forward — the whole file (or the whole run since the
  last rotation) fails `scripts/verify-audit-log.ts`.
- **Redacting just the `details` field** of one entry (e.g. replacing a
  recipient-identifying value with `[ERASED]`) changes that entry's
  canonical payload, so its own `hash` no longer matches
  `sha256(prevHash + canonicalize(payload))` — this *also* breaks the chain
  from that entry onward, for the same reason.

**Resolution, not a workaround**: GDPR does not actually require breaking
this chain. Article 17(3)(b) exempts data still needed "for compliance with
a legal obligation," and Article 17(3)(e) exempts data needed for "the
establishment, exercise or defence of legal claims" — an audit trail that
exists specifically to detect fraud, prove policy compliance, and support
incident response falls squarely under both. The audit log is therefore
**retained intact, chain unbroken, for its full 6-year period, and not
redacted on an erasure request** — the erasure procedure above deletes the
*source* data (spending, orders, profile) while leaving the *record that an
event occurred* in place. This is a deliberate, documented policy choice,
not an oversight: if a future requirement makes per-entry redaction
mandatory, it needs a chain design that tolerates it (e.g. a Merkle tree
keyed per-recipient, or signing entries individually instead of chaining
them) — noted here as a real limitation of the current design, not solved by
this issue.

---

## What's protected at rest vs. only scrubbed in transit to the LLM

- **In transit to the LLM provider**: `shared/prompt-scrub.ts` replaces real
  patient/caregiver names with stable pseudonyms (`Rosa Garcia` → `Patient A`)
  for the duration of an agent run, per `docs/SECURITY.md`'s #97 section.
  This protects exactly one thing — the text sent to a third-party LLM API —
  and nothing else.
- **At rest, today, protection is *exposure prevention*, not encryption.**
  Every PHI/PII file in the table above is plain, unencrypted JSON/JSONL/SQLite
  on the local (or Render) filesystem. What ADR 002 calls "protecting" this
  data is: `.gitignore` patterns (`data/**/*.json`, `data/**/*.jsonl`) that
  keep it out of version control, plus a CI check that fails a PR if a data
  file appears in the diff. **This does not protect against a compromised
  host, an unencrypted disk snapshot/backup, or anyone with filesystem
  access to the running container** — there is no AES-GCM envelope or
  database-level encryption on any of these files today. ADR 002's own
  "Alternatives considered" table lists "Encrypted JSON" and "PostgreSQL
  (with encryption at rest)" as *not yet implemented* options.
- **Practical consequence**: on testnet, this gap is low-severity — the
  demo data (Rosa's medications, spending) is fictional. On mainnet, the
  same code path would hold real patient data with the same lack of
  encryption at rest — this is exactly the "on mainnet, this would leak
  actual patient data" scenario ADR 002 already names, extended from *git
  exposure* to *at-rest encryption* as a second, still-open gap.

---

## HIPAA/GDPR obligations and the testnet-vs-mainnet accepted-risk posture

- **GDPR Art. 5(1)(e)** ("storage limitation") is why every data class above
  has a bounded retention period rather than "keep forever" — data may only
  be kept "for no longer than is necessary for the purposes for which [it]
  are processed."
- **GDPR Art. 17** ("right to erasure") is the basis for the deletion
  procedure above; **Art. 17(3)(b)** and **17(3)(e)** are the specific
  exceptions that justify keeping the audit log's hash chain intact instead
  of redacting or deleting matching entries.
- **GDPR Art. 12(3)** sets the one-month (extendable to three) response
  deadline used for both routine offboarding and on-demand erasure above.
- **HIPAA 45 CFR § 164.316(b)(2)(i)** requires covered entities/business
  associates to retain required Security Rule documentation — including
  security-incident records, which is what the audit log functionally is —
  for **6 years** from creation or last effective date. This is the basis
  for the audit log's 6-year policy *target* above — not yet an enforced
  guarantee; see the note under the table for the size/count-based rotation
  gap that needs closing before the code actually meets it. **Important
  distinction, to avoid a common misreading**: HIPAA does *not* itself
  mandate a retention period for PHI/medical records generally (spending
  records, orders, the
  care-recipient profile) — that's governed by state law in the US, which
  varies by state and isn't something this repo can determine or fix
  centrally. The 30-day figure for those data classes comes from GDPR's
  storage-limitation/erasure-response framework instead, not from HIPAA.
- **Accepted-risk posture, testnet vs. mainnet**: CareGuard runs on Stellar
  testnet today (`STELLAR_NETWORK=testnet`), and every data class above
  currently holds synthetic demo data (Rosa, Maria) rather than real patient
  information — so a gap like "no encryption at rest" is accepted as
  low-severity for now, consistent with how
  [ADR 002](../adr/002-pii-in-persistence.md) already frames the same
  question for git exposure. This acceptance is explicitly **scoped to
  testnet and does not carry over to a mainnet cutover** —
  [`docs/release/production-readiness.md`](../release/production-readiness.md)'s
  existing "Testnet → Mainnet Cutover Gates" checklist does not yet include
  an at-rest-encryption gate; adding one before any real-patient-data
  mainnet launch is a prerequisite this doc surfaces but does not itself
  implement (out of scope for issue #755).

---

## Related

- [`docs/data/storage.md`](./storage.md) — file layout this policy governs
- [`docs/adr/002-pii-in-persistence.md`](../adr/002-pii-in-persistence.md) — the PII-in-persistence decision this policy formalises a retention/erasure answer for
- [`docs/SECURITY.md`](../SECURITY.md) — PHI scrubbing (in transit to the LLM) and the broader threat model
- [`docs/runbooks/audit-log-tamper-detected.md`](../runbooks/audit-log-tamper-detected.md) — what happens if the audit chain breaks (including from an unplanned edit)
- [`docs/release/production-readiness.md`](../release/production-readiness.md) — testnet → mainnet cutover gates
