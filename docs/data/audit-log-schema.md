# Audit Log JSONL Record Schema

This document is the field-by-field reference for the records written by
[`shared/audit-log.ts`](../../shared/audit-log.ts). For the design
rationale (why hash-chained JSONL, why this canonicalization scheme, known
residual risks), see
[ADR 008: Append-Only Hash-Chained Audit Log Design](../adr/008-audit-log-hash-chain.md).
This doc is the precise schema an operator or integrator needs to parse
and independently verify the log — it does not repeat the ADR's rationale.

---

## File location and naming

- **Active file**: `<DATA_DIR>/audit.log.jsonl`, where `DATA_DIR` defaults
  to the repo's `data/` directory and can be overridden by the `DATA_DIR`
  environment variable (`getAuditFilePath()`,
  `shared/audit-log.ts:12`).
- **Rotated archives**: `audit.log.jsonl.1` through `audit.log.jsonl.12`.
  `.1` is the **most recently** rotated segment; `.12` is the oldest one
  still retained. See "Rotation," below, for the exact renaming sequence
  and why archive numbering works this way.
- One JSON object per line (JSONL) — no wrapping array, no trailing
  comma, one `\n`-terminated record per append.

---

## Record fields

Every line is a single JSON object with exactly these six fields, always
emitted in this order (`appendAuditEntry()`, `shared/audit-log.ts:100`):

| Field | Type | Set by | Description |
|---|---|---|---|
| `timestamp` | string | server, at write time | ISO-8601 UTC, `new Date().toISOString()`. Not caller-supplied — the caller cannot backdate an entry. |
| `event` | string | caller | Free-form, dot-namespaced category. See "Event catalog," below, for every value currently in use. |
| `actor` | string | caller | Who or what triggered the event. See "Actor catalog," below. |
| `details` | object \| omitted | caller | Event-specific structured payload (`Record<string, unknown>`). Optional — the `AuditEntry` interface (`shared/audit-log.ts:23`) does not require it, and callers that have nothing extra to record omit it entirely rather than sending `{}` or `null`. |
| `prevHash` | string | server | 64-character lowercase hex. The `hash` of the immediately preceding line in this **same file**, or the 64-character genesis sentinel (all zeros) if this is the first entry ever written to this segment. See "Hash chain," below — this is *not* necessarily the previous entry ever written overall; see the rotation caveat. |
| `hash` | string | server | 64-character lowercase hex SHA-256 digest binding this entry to the chain. See "Hash chain," below for the exact formula. |

Field **order** in the emitted JSON text follows this table (an artifact
of object key insertion order in `appendAuditEntry()`), but this is not a
format guarantee — parse the line as JSON and access fields by name, not
by position.

### Event catalog (as of this writing)

`event` has no fixed enum in the code — any string is accepted. These are
every value currently produced by a real call site (test-only fixtures
excluded):

| Event | Emitted by |
|---|---|
| `tool_call` | `agent/runner.ts` — one per tool call the agent makes during a run |
| `agent.iteration_limit_reached` | `agent/runner.ts` |
| `agent.tool_cap_exceeded` | `agent/runner.ts` |
| `agent.paused` / `agent.resumed` | `server.ts` |
| `agent.policy_updated` | `server.ts`, `agent/server.ts` |
| `agent.reset` | `server.ts`, `agent/server.ts` |
| `agent.auto-paused` | `shared/wallet-balance.ts` — low USDC/XLM balance auto-pause |
| `policy.updated` | `agent/tools.ts` |
| `spending.reset` | `agent/tools.ts` |
| `transaction.category_migrated` | `agent/tools.ts` |
| `task.suspicious` | `shared/task-validation.ts` |

### Actor catalog (as of this writing)

| Actor | Meaning |
|---|---|
| `agent` | The AI agent itself, acting autonomously during a run |
| `api` | An HTTP request handler acting on direct caller input |
| `caregiver` | An action attributed to the caregiver operating the dashboard |
| `system` | An internal, non-request-triggered process (e.g. a data migration) |
| `wallet-balance-check` | The background wallet-balance monitor |

`actor` is a plain string, not an enum either — a new call site can
introduce a new value at any time.

---

## Canonicalization used for hashing

`canonicalize()` (`shared/audit-log.ts:29`) produces a deterministic
string form of a JSON value so the SHA-256 hash is reproducible across
platforms and runs:

- `null` → the literal string `"null"`
- Arrays → `[` + each element canonicalized, comma-joined + `]`
- Objects → keys sorted **alphabetically**, then `{` + each
  `"key":value` pair, comma-joined + `}` — recursively, so nested objects
  are also key-sorted
- Everything else (strings, numbers, booleans) → `JSON.stringify(value)`

This function runs only over the **payload** —
`{ timestamp, event, actor, details }` — never over `prevHash` or `hash`
themselves. `prevHash` is concatenated onto the canonicalized payload as a
raw string prefix; `hash` is the output, never an input.

---

## Hash chain

### Formula

For entry *i* in a given file segment:

```
prevHash_i = hash_(i-1)                                   // or genesis, for i = 0
hash_i     = SHA256( prevHash_i + canonicalize(payload_i) )
```

where `payload_i` is `{ timestamp, event, actor, details }` for that
entry, and the genesis sentinel is:

```
0000000000000000000000000000000000000000000000000000000000000000
```

(64 ASCII zero characters — this is the literal string used for the first
entry of any segment, `shared/audit-log.ts:120`.)

### Verifying one line by hand

Given a line, extract every field except `prevHash` and `hash` into the
payload, canonicalize it the same way, and confirm:

```bash
python3 - <<'PY'
import json, hashlib

line = '''<paste the JSON line here>'''
rec = json.loads(line)
prev_hash, expected_hash = rec.pop("prevHash"), rec.pop("hash")

def canonicalize(v):
    if v is None:
        return "null"
    if isinstance(v, list):
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(f'{json.dumps(k)}:{canonicalize(v[k])}' for k in sorted(v)) + "}"
    return json.dumps(v)

computed = hashlib.sha256((prev_hash + canonicalize(rec)).encode()).hexdigest()
print("match" if computed == expected_hash else "MISMATCH", computed)
PY
```

### Offline verification — the authoritative tool

Don't reimplement the check above by hand for a whole file — use
[`scripts/verify-audit-log.ts`](../../scripts/verify-audit-log.ts), the
same logic the codebase itself relies on:

```bash
npx tsx scripts/verify-audit-log.ts
```

It reads the active file (`$DATA_DIR/audit.log.jsonl`, or the exact path
in `$AUDIT_FILE` if you set that instead), walks every line from index 0,
and for each one: confirms `prevHash` equals the previous line's `hash`
(starting from genesis), recomputes `hash` from `prevHash` +
`canonicalize(payload)`, and confirms it matches the stored value. On
success it prints the total entry count and exits `0`; on the first
mismatch it prints the failing line number/index and exits `1`
(consumed by [`audit-log-tamper-detected.md`](../runbooks/audit-log-tamper-detected.md)).

For CI and machine-readable checks, add `--json`. It emits an object with
`ok` and `errors` fields and retains the same non-zero exit status on a failed
verification:

```bash
npx tsx scripts/verify-audit-log.ts --json
```

To verify a **rotated archive** instead of the live file, point
`AUDIT_FILE` at it directly:

```bash
AUDIT_FILE=data/audit.log.jsonl.1 npx tsx scripts/verify-audit-log.ts
```

**This only verifies one file per run.** There is no built-in command that
walks every archive plus the active file in one pass — see "Rotation,"
below, for why that also wouldn't mean what it sounds like it means.

---

## Rotation

### File naming and the rotation algorithm

Rotation is checked at the start of every `appendAuditEntry()` call
(`rotateLogs()`, `shared/audit-log.ts:79`) — it's **not** a timer, so the
active file can transiently exceed the 10 MB threshold (`MAX_FILE_SIZE`,
`shared/audit-log.ts:20`) between the write that crosses it and the next
call that actually triggers rotation. When the active file is at or above
10 MB:

1. If `audit.log.jsonl.12` exists, it is deleted (`MAX_ARCHIVES = 12`,
   `shared/audit-log.ts:21`) — the oldest retained archive is gone.
2. Every remaining archive shifts up by one: `.11` → `.12`, `.10` → `.11`,
   ... `.1` → `.2`.
3. The current active file, `audit.log.jsonl`, is renamed to
   `audit.log.jsonl.1` — it is now the newest archive.
4. A fresh, empty `audit.log.jsonl` is created by the **next** write (not
   by `rotateLogs()` itself — the empty-file creation happens later in the
   same `appendAuditEntry()` call, at `shared/audit-log.ts:112`-`113`).

Retained history is capped at roughly 10 MB × 12 archives, plus up to
~10 MB in the active file — files are plain, uncompressed JSONL, there is
no gzip step.

### How rotated segments chain together — verified against actual behavior

**They don't, cryptographically.** This was confirmed by exercising the
real rotation code path directly (forcing rotation with oversized entries
and inspecting the output), not inferred from reading it: when
`rotateLogs()` renames the active file away, the very next line in
`appendAuditEntry()` checks whether the active path exists — it doesn't
yet, so `writeFileSync(auditFile, "", "utf-8")` creates a brand-new, empty
file. `getLastLine()` is then called against that empty file and returns
`null`, so the new segment's very first entry falls back to the genesis
`prevHash` — **not** the previous segment's final `hash`.

Concretely: after rotation, `audit.log.jsonl`'s first entry has
`prevHash = "000...000"`, and so does `audit.log.jsonl.1`'s first entry
(from when *it* was created as a fresh active file, before it was later
rotated in turn). Every segment — the active file and each of the up-to-12
archives — is an **independent, internally-consistent hash chain that
starts at genesis**. There is no field anywhere in the schema that links
one segment's last entry to the next segment's first entry.

**What this means for verification**: continuity across segments today is
established only by **filename ordering** (`.12` is older than `.1` is
older than the active file) and by comparing `timestamp` ranges between
segments — not by any hash. To check the full retained history:

1. Run `scripts/verify-audit-log.ts` once per file, oldest archive first
   (`AUDIT_FILE=data/audit.log.jsonl.12`, then `.11`, ... down to `.1`,
   then the active file with no override). Each run only confirms that
   *that one segment* is internally untampered — a clean result from all
   of them does not, by itself, prove no segment is entirely missing.
2. Separately confirm there's no gap in the archive suffix sequence
   (e.g. `.5` present but `.6` absent, with `.7` present, is a hole) and
   that each segment's `timestamp` range picks up roughly where the
   previous one leaves off. The tooling in this repo does not automate
   this cross-segment check today — it's a manual step.

---

## Annotated example record

Generated against the real `appendAuditEntry()`/`canonicalize()` code
(genesis entry — the first line ever written to an empty segment, so
`prevHash` is the all-zero sentinel):

```json
{
  "timestamp": "2026-07-29T10:22:09.576Z",
  "event": "tool_call",
  "actor": "agent",
  "details": {
    "tool": "pharmacy_compare",
    "inputs": { "drugName": "lisinopril", "quantity": 30 },
    "resultHash": "67084ee24a3a85f36c0c31007475be5d2b7ecf1fe4aa01228552e10162550e15"
  },
  "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "hash": "0e1e2ed161c3c88b7cef4647afaf7bd8b38d3af172adfb172a3cfcaf5a3b47e2"
}
```

Field notes:

- `event: "tool_call"` with a `details.tool` / `details.inputs` /
  `details.resultHash` shape is exactly what `agent/runner.ts` writes
  after every tool call the agent makes — note that the *tool's actual
  result* is never stored verbatim, only a SHA-256 hash of it
  (`resultHash`), so this event proves a specific result was produced
  without duplicating potentially sensitive tool output into the audit
  log itself.
- `prevHash` is the genesis sentinel because this is shown as the first
  entry of a segment; a second entry appended after this one would carry
  `prevHash: "0e1e2ed161c3c88b7cef4647afaf7bd8b38d3af172adfb172a3cfcaf5a3b47e2"`
  — this record's own `hash`.
- You can verify `hash` yourself with the hand-verification snippet
  above — it will reproduce `0e1e2ed1...3b47e2` from this exact JSON.

---

## Related

- [ADR 008: Append-Only Hash-Chained Audit Log Design](../adr/008-audit-log-hash-chain.md) —
  design rationale, consequences, and residual risks
- [`docs/data/storage.md`](./storage.md) — where this file sits alongside
  the rest of CareGuard's runtime state under `data/`
- [`docs/data/retention.md`](./retention.md) — retention periods and the
  tension between "append-only, tamper-evident" and lawful data erasure
- [`docs/runbooks/audit-log-tamper-detected.md`](../runbooks/audit-log-tamper-detected.md) —
  incident response when `scripts/verify-audit-log.ts` reports a mismatch
- `shared/audit-log.ts` — the source this document describes
- `scripts/verify-audit-log.ts` — the offline verifier referenced throughout
