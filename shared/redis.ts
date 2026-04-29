/**
 * Redis client with in-process fallback.
 *
 * When REDIS_URL is set, uses ioredis to connect to Redis.
 * When REDIS_URL is unset, falls back to an in-process Map-based cache with a
 * warning log. The fallback is not shared across server instances.
 */

import Redis from "ioredis";

export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<void>;
  acquireLock(key: string, ttlMs: number): Promise<boolean>;
}

// ─── In-process fallback ──────────────────────────────────────────────────────

export function createInMemoryClient(): CacheClient {
  interface Entry {
    value: string;
    expiresAt: number | null;
  }
  const store = new Map<string, Entry>();

  function live(entry: Entry): boolean {
    return entry.expiresAt === null || Date.now() < entry.expiresAt;
  }

  return {
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
      console.error(`[redis] connection error: ${err.message}`);
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
        console.error(`[redis] get error, returning null: ${(err as Error).message}`);
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
        console.error(`[redis] set error: ${(err as Error).message}`);
      }
    },

    async incr(key) {
      try {
        return await redis.incr(key);
      } catch (err: unknown) {
        console.error(`[redis] incr error: ${(err as Error).message}`);
        return 0;
      }
    },

    async del(key) {
      try {
        await redis.del(key);
      } catch (err: unknown) {
        console.error(`[redis] del error: ${(err as Error).message}`);
      }
    },

    async acquireLock(key, ttlMs) {
      try {
        const result = await redis.set(key, "1", "PX", ttlMs, "NX");
        return result === "OK";
      } catch (err: unknown) {
        console.error(`[redis] acquireLock error: ${(err as Error).message}`);
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
      console.warn(
        "[redis] REDIS_URL not set — using in-process cache. " +
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
