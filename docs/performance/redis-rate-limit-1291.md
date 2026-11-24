# Redis vs rate-limit burst (#1291)

Run: `npm run benchmark:redis-rate-limit`

Rate limiting is in-process today (`express-rate-limit`); `REDIS_URL` is not wired to limiters yet. The benchmark load-tests INCR per request via in-memory vs `ioredis-mock`.

**Recommend:** single shared ioredis client when enabling `rate-limit-redis`; pipeline INCR+EXPIRE under burst.

Closes #1291.
