/**
 * Redis client with in-process fallback.
 *
 * When REDIS_URL is set, uses ioredis to connect to Redis.
 * When REDIS_URL is unset, falls back to an in-process Map-based cache with a
 * warning log. The fallback is not shared across server instances.
 *
 * ioredis-mock version relationship (issue #1385): ioredis-mock's major version
 * is unrelated to ioredis's. This repo uses ioredis ^5 (resolves to 5.x) plus
 * ioredis-mock ^8 in devDependencies; ioredis-mock 8.x declares ioredis ^5 as a
 * peer dependency and tracks the ioredis 5.x command surface. The full surface
 * used here — GET, SET (incl. PX/NX), INCR, DEL — is covered by ioredis-mock
 * (see shared/__tests__/redis-ioredis-mock.test.ts). When upgrading ioredis to
 * a new major, upgrade ioredis-mock to the 8.x line that tracks that major.
 */

import Redis from "ioredis";
import { logger } from "./logger.ts";

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<void>;
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
}

// ─── In-process fallback ──────────────────────────────────────────────────────

/** Expired in-memory entries are swept once per minute by default. */
export const IN_MEMORY_SWEEP_INTERVAL_MS = 60_000;

export interface InMemoryCacheClient extends CacheClient {
  readonly size: number;
}

export function createInMemoryClient(
  sweepIntervalMs = IN_MEMORY_SWEEP_INTERVAL_MS,
): InMemoryCacheClient {
  if (!Number.isFinite(sweepIntervalMs) || sweepIntervalMs <= 0) {
    throw new RangeError("sweepIntervalMs must be a positive finite number");
  }

  interface Entry {
    value: string;
    expiresAt: number | null;
  }
  const store = new Map<string, Entry>();

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt !== null && now >= entry.expiresAt) {
        store.delete(key);
      }
    }
  }, sweepIntervalMs);
  sweepTimer.unref();

  function live(entry: Entry): boolean {
    return entry.expiresAt === null || Date.now() < entry.expiresAt;
  }

  return {
    get size() {
      return store.size;
    },

    async get(key) {
      const entry = store.get(key);
      if (!entry || !live(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key, value, ttlMs) {
      store.set(key, {
        value,
        expiresAt: ttlMs != null ? Date.now() + ttlMs : null,
      });
    },

    async incr(key) {
      const entry = store.get(key);
      const current =
        entry && live(entry) ? parseInt(entry.value, 10) || 0 : 0;
      const next = current + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    },

    async del(key) {
      store.delete(key);
    },

    async acquireLock(key, ttlMs) {
      const entry = store.get(key);
      if (entry && live(entry)) return false;
      store.set(key, { value: "1", expiresAt: Date.now() + ttlMs });
      return true;
    },
  };
}

// ─── Redis-backed client ──────────────────────────────────────────────────────

type RawRedis = {
  get(key: string): Promise<string | null>;
  set(...args: unknown[]): Promise<unknown>;
  incr(key: string): Promise<number>;
  del(...keys: string[]): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): RawRedis;
};

export function createRedisClient(urlOrInstance: string | RawRedis): CacheClient {
  let redis: RawRedis;

  if (typeof urlOrInstance === "string") {
    const r = new Redis(urlOrInstance);
    r.on("error", (err: Error) => {
      logger.error({ err: err.message }, "redis connection error");
    });
    redis = r as unknown as RawRedis;
  } else {
    redis = urlOrInstance;
  }

  return {
    async get(key) {
      try {
        return await redis.get(key);
      } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, "redis get error");
        return null;
      }
    },

    async set(key, value, ttlMs) {
      try {
        if (ttlMs != null) {
          await redis.set(key, value, "PX", ttlMs);
        } else {
          await redis.set(key, value);
        }
      } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, "redis set error");
      }
    },

    async incr(key) {
      try {
        return await redis.incr(key);
      } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, "redis incr error");
        return 0;
      }
    },

    async del(key) {
      try {
        await redis.del(key);
      } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, "redis del error");
      }
    },

    async acquireLock(key, ttlMs) {
      try {
        const result = await redis.set(key, "1", "PX", ttlMs, "NX");
        return result === "OK";
      } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, "redis acquireLock error");
        return false;
      }
    },
  };
}

// ─── Default singleton (lazy) ─────────────────────────────────────────────────

let _defaultClient: CacheClient | undefined;

function getDefaultClient(): CacheClient {
  if (!_defaultClient) {
    const url = process.env.REDIS_URL;
    if (url) {
      _defaultClient = createRedisClient(url);
    } else {
      logger.warn(
        "REDIS_URL not set — using in-process cache. " +
          "State is not shared across instances and is lost on restart.",
      );
      _defaultClient = createInMemoryClient();
    }
  }
  return _defaultClient;
}

/** Reset the default client (for testing). */
export function _resetDefaultClient(): void {
  _defaultClient = undefined;
}

export const get = (key: string) => getDefaultClient().get(key);
export const set = (key: string, value: string, ttlMs?: number) =>
  getDefaultClient().set(key, value, ttlMs);
export const incr = (key: string) => getDefaultClient().incr(key);
export const del = (key: string) => getDefaultClient().del(key);
export const acquireLock = (key: string, ttlMs: number) =>
  getDefaultClient().acquireLock(key, ttlMs);
