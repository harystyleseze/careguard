/**
 * Ioredis-mock command-surface audit (issue #1385).
 *
 * ioredis-mock's major version is unrelated to ioredis's. We pin ioredis ^5 in
 * dependencies and ioredis-mock ^8 in devDependencies; ioredis-mock 8.x targets
 * the ioredis 5.x API surface (peer dependency `ioredis: ^5`), so its command
 * set stays aligned with the ioredis 5.x commands below.
 *
 * Command surface actually used by agent/services code — all routed through
 * `shared/redis.ts`:
 *   - GET                    redis.get(key)                 (shared/redis.ts)
 *   - SET key value          redis.set(key, value)
 *   - SET key value PX ms    redis.set(key, value, "PX", ttlMs)
 *   - SET key v PX ms NX     redis.set(key, "1", "PX", ttlMs, "NX")  [acquireLock]
 *   - INCR key               redis.incr(key)
 *   - DEL key                redis.del(key)
 *
 * ioredis-mock implements every command in this list. These tests run each one
 * against a fresh ioredis-mock instance and assert real behaviour, so an
 * unimplemented command surfaces as a failure instead of a silent no-op.
 */

import { describe, it, expect } from "vitest";
import { createRedisClient } from "../redis.ts";
import type { CacheClient } from "../redis.ts";
import IORedisMock from "ioredis-mock";

describe("ioredis-mock coverage of the ioredis commands used by the app (#1385)", () => {
  let mock: InstanceType<typeof IORedisMock>;
  let cache: CacheClient;

  beforeEach(() => {
    mock = new IORedisMock();
    cache = createRedisClient(mock);
  });

  it("GET returns null for a missing key", async () => {
    expect(await mock.get("missing")).toBeNull();
  });

  it("SET stores a value retrievable via GET", async () => {
    await mock.set("k", "v");
    expect(await mock.get("k")).toBe("v");
  });

  it("SET with PX sets a millisecond TTL", async () => {
    await mock.set("ttl", "1", "PX", 5);
    expect(await mock.get("ttl")).toBe("1");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(await mock.get("ttl")).toBeNull();
  });

  it("SET ... NX PX only acquires when the lock is free (acquireLock)", async () => {
    const first = await mock.set("lock", "1", "PX", 5000, "NX");
    expect(first).toBe("OK");
    const second = await mock.set("lock", "1", "PX", 5000, "NX");
    expect(second).not.toBe("OK");
  });

  it("INCR creates and increments counters atomically", async () => {
    expect(await mock.incr("hits")).toBe(1);
    expect(await mock.incr("hits")).toBe(2);
    expect(await mock.get("hits")).toBe("2");
  });

  it("DEL removes an existing key", async () => {
    await mock.set("gone", "x");
    expect(await mock.del("gone")).toBe(1);
    expect(await mock.get("gone")).toBeNull();
  });

  it("exercises the full surface through shared/redis.ts CacheClient", async () => {
    expect(await cache.acquireLock("mpp:lock", 5000)).toBe(true);
    expect(await cache.acquireLock("mpp:lock", 5000)).toBe(false);
    await cache.set("counter", "4");
    expect(await cache.incr("counter")).toBe(5);
    await cache.set("flag", "on", 1000);
    expect(await cache.get("flag")).toBe("on");
    await cache.del("flag");
    expect(await cache.get("flag")).toBeNull();
  });
});