# Spending State Lifecycle

CareGuard keeps spending data in memory per care recipient and syncs it to disk atomically.

- `loadSpending(recipientId)` returns the cached state when it is still fresh.
- The cache refreshes from `data/recipients/<recipientId>/spending.json` every 5 seconds.
- `saveSpending(data, recipientId)` writes to a temp file and renames it into place to avoid torn reads.
- `setCurrentRecipient(recipientId)` switches the active recipient and ensures the directory exists before any write.

Operationally, this means:

- repeated tool calls reuse memory instead of hitting disk every time,
- a crashed process can restart from the last committed JSON file,
- and a reader never sees a partially written spending file.
