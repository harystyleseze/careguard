# Spending-policy evaluation (#1292)

Run: `npm run benchmark:spending-policy`

`checkSpendingPolicy` calls `loadPolicy()` (sync disk read) every time and scans `transactions` for today's spend — O(n) in history length.

**Recommend:** in-memory policy cache; maintain per-day category totals instead of filtering full history.

Closes #1292.
