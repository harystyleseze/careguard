# Architectural Decision Records (ADRs)

This directory contains records of key architectural decisions made in the CareGuard project.

## Index

| ADR ID | Decision Record | Status | Date |
|--------|-----------------|--------|------|
| **001** | [001-pharmacy-zip.md](001-pharmacy-zip.md) — Zip Code-Aware Pharmacy Pricing Model | Accepted | 2026-06-25 |
| **002** | [002-pii-in-persistence.md](002-pii-in-persistence.md) — PII-Sensitive Data in Local Persistence | Accepted | 2026-06-29 |
| **004** | [004-pharmacy-pricing-source.md](004-pharmacy-pricing-source.md) — Pharmacy Pricing Source Integration | Accepted | 2026-07-10 |
| **005** | [005-strict-type-checking-flags.md](005-strict-type-checking-flags.md) — Deferred Adoption of noUncheckedIndexedAccess and noImplicitOverride | Proposed | 2026-08-27 |
| **006** | [006-typescript-runtime.md](006-typescript-runtime.md) — TypeScript Runtime Strategy | Accepted | 2026-07-22 |
| **008** | [008-audit-log-hash-chain.md](008-audit-log-hash-chain.md) — Append-Only Hash-Chained Audit Log Design | Accepted | 2026-07-27 |
| **009** | [009-stop-agent-http-loopback.md](009-stop-agent-http-loopback.md) — Stop Routing Agent Tool Calls Over HTTP Loopback | Proposed | 2026-08-27 |
| **010** | [010-standardize-storage-layer.md](010-standardize-storage-layer.md) — Standardize Storage-Layer Conventions | Proposed | 2026-08-27 |
| **011** | [011-shared-server-bootstrap.md](011-shared-server-bootstrap.md) — Extract a Shared Server-Bootstrap Module | Proposed | 2026-08-27 |
| **012** | [012-namespace-metrics-per-service.md](012-namespace-metrics-per-service.md) — Namespace Shared Metrics Per Service | Proposed | 2026-08-27 |
| **—**   | [unified-vs-split-server.md](unified-vs-split-server.md) — Unified vs Split Server Architecture | Accepted | 2026-07-15 |
# Architecture Decision Records

This directory records key architectural decisions for CareGuard.
Each ADR is a short, immutable document describing a decision, its
context, and its consequences.

## Numbering Convention

ADRs are numbered sequentially with a zero-padded three-digit prefix
(e.g., `001`, `002`). This keeps the directory listing sorted and
makes cross-references unambiguous.

| Format | Example | Status |
|--------|---------|--------|
| `NNN-title-with-dashes.md` | `004-pharmacy-pricing-source.md` | ✅ Current standard |

Legacy ADRs that do not follow the numbering convention (e.g.,
`unified-vs-split-server.md`) are assigned a number in the index
below. Their filenames remain unchanged for link stability; the
index entry is the authoritative reference.

## Status Lifecycle

Every ADR has one of the following statuses:

| Status | Meaning |
|--------|---------|
| **Proposed** | Under discussion; not yet implemented |
| **Accepted** | Implemented and in effect |
| **Superseded** | Replaced by a newer ADR — see the superseding ADR for current guidance |

### Supersede Process

1. Create a new ADR that documents the replacement decision.
2. In the new ADR's header, add a `Supersedes: NNN` reference.
3. Update the superseded ADR's header to add `Superseded by: NNN`.
4. Update the status column in this index.

## Index

| # | Title | Status |
|---|-------|--------|
| 001 | [Pharmacy ZIP Code Consolidation](001-pharmacy-zip.md) | Accepted |
| 002 | [PII in Persistence and Audit](002-pii-in-persistence.md) | Accepted |
| 003 | [Unified vs. Split Server](unified-vs-split-server.md) | Accepted |
| 004 | [Pharmacy Pricing Source](004-pharmacy-pricing-source.md) | Accepted |
| 005 | [Deferred Adoption of noUncheckedIndexedAccess and noImplicitOverride](005-strict-type-checking-flags.md) | Proposed |
| 006 | [TypeScript Runtime Strategy](006-typescript-runtime.md) | Accepted |
| 008 | [Append-Only Hash-Chained Audit Log](008-audit-log-hash-chain.md) | Accepted |
| 009 | [Stop Agent HTTP Loopback](009-stop-agent-http-loopback.md) | Proposed |
| 010 | [Standardize Storage-Layer Conventions](010-standardize-storage-layer.md) | Proposed |
| 011 | [Shared Server-Bootstrap Module](011-shared-server-bootstrap.md) | Proposed |
| 012 | [Namespace Metrics Per Service](012-namespace-metrics-per-service.md) | Proposed |

> **Note:** ADR 003 was originally documented as `unified-vs-split-server.md`
> without a numeric prefix. It is canonically referenced as ADR 003 in this
> index. When creating new ADRs, use the zero-padded format.

---

## Template

Copy the following block when drafting a new ADR:

```markdown
# ADR-NNN: <Short Title>

- **Status:** Proposed | Accepted | Superseded
- **Date:** YYYY-MM-DD
- **Supersedes:** (optional — number of ADR this replaces)
- **Superseded by:** (optional — number that replaces this ADR)

## Context

What is the issue that motivated this decision? What constraints,
trade-offs, or prior decisions are relevant?

## Decision

What is the change that we are proposing or have agreed to?

## Consequences

Why is this decision a good idea? What are the positive and negative
outcomes? What follow-up work does it enable or block?

## Compliance

How will we verify that the decision is being followed? What
automated checks or manual reviews enforce it?
```
