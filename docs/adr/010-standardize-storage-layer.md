# ADR-010: Standardize Storage-Layer Conventions Between JSONL and SQLite Services

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [#1447](https://github.com/harystyleseze/careguard/issues/1447)

## Context

CareGuard uses two unrelated persistence strategies that coexist without a shared interface:

1. **JSONL + Snapshot** (`agent/tools.ts`): The agent persists spending data and transactions as append-only JSONL files with periodic snapshot compaction. Each care recipient has a directory under `data/recipients/<id>/` containing `transactions.jsonl`, `spending.snapshot.json`, `spending.json` (legacy), `policy.json`, `orders.json`, and `adherence.jsonl`. Reads load the snapshot first, then replay JSONL tail lines after `_snapshotTxCount`. Writes are atomic via tmp-file + rename.

2. **SQLite** (`services/pharmacy-api/db.ts` and `services/care-recipients/db.ts`): Both use Node.js built-in `node:sqlite` via `DatabaseSync`. `PharmacyPricingStore` manages `pharmacies`, `drugs`, and `prices` tables with foreign keys. `CareRecipientsStore` manages a `care_recipients` table with a JSON-serialized medications column. Both follow `new DatabaseSync(path)` → `migrate()` → `seedIfEmpty()`.

3. **JSON file with file-locking** (`pharmacy-payment/server.ts`): Orders stored as `data/orders.json` with `proper-lockfile` for concurrency and atomic writes.

A caregiver debugging "where is my data" must learn two different mental models depending on which service they inspect. There is no shared interface, so callers depend on the mechanism rather than a contract.

## Decision

Propose a **shared storage-adapter interface** (`StorageAdapter<T>`) that both JSONL and SQLite backends implement, so callers depend on the interface rather than the mechanism.

### Current Persistence Strategies

| Strategy | Used By | Data Format | Concurrency | Query Capability |
|----------|---------|-------------|-------------|-----------------|
| JSONL + Snapshot | `agent/tools.ts` (spending, transactions, adherence) | Append-only JSON lines + periodic snapshot | File-level atomic writes | Full scan + filter in JS |
| SQLite | `pharmacy-api/db.ts`, `care-recipients/db.ts` | Relational tables | SQLite single-writer | SQL queries, indexes |
| JSON + file-lock | `pharmacy-payment/server.ts` (orders) | Single JSON file | `proper-lockfile` + atomic writes | Full scan |

### Proposed Interface

```ts
interface StorageAdapter<T> {
  /** Retrieve an entity by ID. Returns null if not found. */
  get(id: string): Promise<T | null>;

  /** Store or update an entity. Creates if not present. */
  put(id: string, entity: T): Promise<void>;

  /** List entities, optionally filtered. Supports pagination. */
  query(filter?: Record<string, unknown>, options?: { limit?: number; offset?: number }): Promise<T[]>;

  /** Delete an entity by ID. Returns true if deleted. */
  delete(id: string): Promise<boolean>;

  /** Count entities matching optional filter. */
  count(filter?: Record<string, unknown>): Promise<number>;
}
```

### Implementation Strategies

**`JsonlAdapter<T>`** (wraps `agent/tools.ts` patterns):
- `get(id)`: Reads snapshot, replays JSONL tail, returns the entity
- `put(id, entity)`: Appends to JSONL, triggers compaction at threshold
- `query(filter)`: Loads all entries, filters in JS
- `delete(id)`: Marks as deleted in JSONL (tombstone) or compacts without the entity
- **Leak**: No native indexing — `query()` with complex filters requires full scan. Acceptable for the current data volumes (<10K records per recipient).

**`SqliteAdapter<T>`** (wraps `services/*/db.ts` patterns):
- `get(id)`: `SELECT * FROM table WHERE id = ?`
- `put(id, entity)`: `INSERT OR REPLACE INTO table ...`
- `query(filter)`: Dynamic `WHERE` clause construction
- `delete(id)`: `DELETE FROM table WHERE id = ?`
- **Leak**: SQL-specific features (joins, transactions) are not expressible through the interface. Services that need them use the `SqliteAdapter` directly for those operations.

**`JsonFileAdapter<T>`** (wraps `pharmacy-payment/server.ts` patterns):
- `get(id)`: Reads JSON file, finds entity by ID
- `put(id, entity)`: Acquires file lock, updates, writes atomically
- `query(filter)`: Full scan of JSON array
- **Leak**: No concurrent-write support beyond single-writer locking. Acceptable for orders which are low-volume.

### Pilot Module

**`services/care-recipients`** is the ideal pilot:
- Small surface area (one table, one entity type)
- SQLite-backed with a clean class (`CareRecipientsStore`)
- Routes in `services/care-recipients/server.ts` already delegate to the store
- Low risk — care recipients are created once per caregiver, not on hot paths

The migration involves:
1. Defining `CareRecipientEntity` as the generic type parameter
2. Wrapping `CareRecipientsStore` in a `SqliteAdapter<CareRecipientEntity>`
3. Updating route handlers to call the adapter interface

### Migration Plan

1. **Phase 1 — Define interface**: Create `shared/storage-adapter.ts` with the `StorageAdapter<T>` interface and a `createAdapter()` factory function.

2. **Phase 2 — Pilot with care-recipients**: Implement `SqliteAdapter` for `CareRecipientsStore`. Update `services/care-recipients/server.ts` to use the adapter. No data format migration required — the underlying SQLite database is unchanged.

3. **Phase 3 — Add `JsonlAdapter`**: Implement for `agent/tools.ts` spending/transactions. This is the larger effort — the JSONL + snapshot pattern is more complex. The adapter wraps existing functions rather than replacing them.

4. **Phase 4 — Add `JsonFileAdapter`**: Implement for `pharmacy-payment/server.ts` orders. Wraps existing file-lock + atomic-write pattern.

5. **Phase 5 — Migrate remaining callers**: Update other services to use the adapter where appropriate. Services that need SQL-specific features (joins, transactions) continue to use the underlying store directly.

### Where the Abstraction Leaks

| Leak | Mitigation |
|------|------------|
| `JsonlAdapter.query()` does full-scan filtering — O(n) for complex queries | Acceptable for current data volumes. Document that high-volume queries should use SQLite. |
| `SqliteAdapter` can't express joins or transactions | Services needing joins use the `SqliteStore` directly for those operations. The adapter is for simple CRUD. |
| `JsonFileAdapter` has single-writer concurrency | Acceptable for orders (low volume). Document that high-concurrency stores should use SQLite. |
| `put()` semantics differ: JSONL appends, SQLite upserts, JSON overwrites | Document that `put()` is "upsert" semantics. Callers must not depend on append-only behavior. |

### Data Format Migration

No data format migration is required. The adapters wrap existing storage mechanisms:
- `JsonlAdapter` reads/writes the same JSONL + snapshot files
- `SqliteAdapter` uses the same SQLite database
- `JsonFileAdapter` uses the same JSON file format

Existing deployments continue to work without data migration. The adapter is a code-level abstraction, not a data-level one.

## Consequences

### Positive
- Callers depend on a stable interface rather than implementation details
- New services can choose their storage backend without changing calling code
- Easier to test — mock the adapter interface instead of filesystem/SQLite
- Reduces cognitive load for developers debugging data flow

### Negative
- Abstraction layer adds indirection — must be transparent in stack traces
- Impedance mismatch between file-append (JSONL) and SQL semantics means some operations are inherently different
- Not all services benefit equally — `agent/tools.ts` is the most complex and hardest to adapter-ify

### Risks
- Behavioral drift between adapter implementations. Mitigated by a shared test suite that runs the same assertions against all three backends.
- Performance regression in `JsonlAdapter.query()` for large datasets. Mitigated by documenting the O(n) characteristic and recommending SQLite for high-volume queries.

## Compliance

- New services must implement `StorageAdapter<T>` for their primary persistence layer
- Existing services should migrate to the adapter interface opportunistically (no hard deadline)
- `agent/tools.ts` JSONL persistence must not be replaced with SQLite without a separate ADR — the append-only audit trail is a deliberate design choice (see ADR 008)
- The adapter test suite must pass against all three backends before any service migration
