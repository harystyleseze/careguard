# MPP Pharmacy Payment Persistence

The pharmacy payment service uses MPP charge mode for medication orders. Two
local files under `data/` make the flow restart-safe:

- `data/mpp-store.json` stores MPP challenge, replay, and settlement state for
  the `mppx` charge handler.
- `data/orders.json` stores confirmed pharmacy orders returned by
  `/pharmacy/orders`.

Both files are protected by `proper-lockfile` during writes. JSON updates are
written to a temporary file first and then promoted with `renameSync`, so a
crash cannot leave a partially-written JSON document behind.

## Restart Model

When the service restarts, `createFileBackedMppStore()` opens the same
`data/mpp-store.json` file and exposes the standard MPP `get`, `put`,
`delete`, and atomic `update` operations. This replaces the previous
`Store.memory()` setup, where in-flight charge state disappeared on process
exit.

Confirmed orders are appended to `data/orders.json` with the same lock and
atomic-rename model. After a restart, `/pharmacy/orders` reloads that file and
continues returning previously-confirmed orders.

## Operational Notes

- The file-backed store is intended for the single-process demo deployment.
- For multi-instance production deployments, use a shared atomic store such as
  Redis or SQLite so all instances observe the same MPP state.
- If a temporary file named `*.tmp-*` remains after a crash, it can be removed
  after confirming the main JSON file parses successfully.
