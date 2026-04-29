/**
 * Tests for Redis helpers.
 *
 * These tests use the in-memory client directly (createInMemoryClient), which
 * implements the same CacheClient interface that the Redis-backed client does.
 * For integration tests against a real Redis or ioredis-mock, construct a
 * client with:
 *   import IORedisMock from "ioredis-mock";
 *   const cache = createRedisClient(new IORedisMock());
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryClient, createRedisClient } from "../redis.ts";
import type { CacheClient } from "../redis.ts";

// ─── Shared behaviour suite (run against both implementations) ────────────────

function runSuite(label: string, factory: () => CacheClient) {
  describe(label, () => {
    let cache: CacheClient;

    beforeEach(() => {
      cache = factory();
    });

    describe("get / set", () => {
      it("returns null for a missing key", async () => {
        expect(await cache.get("nonexistent")).toBeNull();
      });

      it("stores and retrieves a string value", async () => {
        await cache.set("key", "hello");
        expect(await cache.get("key")).toBe("hello");
      });

      it("overwrites an existing value", async () => {
        await cache.set("key", "first");
        await cache.set("key", "second");
        expect(await cache.get("key")).toBe("second");
      });

      it("returns null after TTL expires", async () => {
        await cache.set("ttlkey", "value", 1); // 1 ms TTL
        await new Promise((r) => setTimeout(r, 10));
        expect(await cache.get("ttlkey")).toBeNull();
      });

      it("returns value before TTL expires", async () => {
        await cache.set("ttlkey2", "alive", 5000); // 5 s TTL
        expect(await cache.get("ttlkey2")).toBe("alive");
      });
    });

    describe("incr", () => {
      it("initialises a missing key to 1", async () => {
        expect(await cache.incr("counter")).toBe(1);
      });

      it("increments an existing counter", async () => {
        await cache.set("counter", "5");
        expect(await cache.incr("counter")).toBe(6);
      });

      it("increments across multiple calls", async () => {
        await cache.incr("hits");
        await cache.incr("hits");
        const n = await cache.incr("hits");
        expect(n).toBe(3);
      });
    });

    describe("del", () => {
      it("deletes an existing key", async () => {
        await cache.set("todelete", "x");
        await cache.del("todelete");
        expect(await cache.get("todelete")).toBeNull();
      });

      it("is a no-op for a missing key", async () => {
        await expect(cache.del("ghost")).resolves.toBeUndefined();
      });
    });

    describe("acquireLock", () => {
      it("returns true when the lock is not held", async () => {
        expect(await cache.acquireLock("lock:a", 5000)).toBe(true);
      });

      it("returns false when the lock is already held", async () => {
        await cache.acquireLock("lock:b", 5000);
        expect(await cache.acquireLock("lock:b", 5000)).toBe(false);
      });

      it("can be re-acquired after expiry", async () => {
        await cache.acquireLock("lock:c", 1); // 1 ms TTL
        await new Promise((r) => setTimeout(r, 10));
        expect(await cache.acquireLock("lock:c", 5000)).toBe(true);
      });

      it("different keys are independent", async () => {
        await cache.acquireLock("lock:d", 5000);
        expect(await cache.acquireLock("lock:e", 5000)).toBe(true);
      });
    });
  });
}

// Run against the in-memory implementation
runSuite("In-memory CacheClient", () => createInMemoryClient());

// Run against the Redis-backed client wired to ioredis-mock.
// Skip gracefully when ioredis-mock is not installed.
let IORedisMock: new () => object;
try {
  // Dynamic import so the rest of the file still runs without the package
  const mod = await import("ioredis-mock");
  IORedisMock = (mod.default ?? mod) as new () => object;
} catch {
  IORedisMock = null as unknown as new () => object;
}

if (IORedisMock) {
  runSuite("Redis-backed CacheClient (ioredis-mock)", () =>
    createRedisClient(new IORedisMock() as Parameters<typeof createRedisClient>[0]),
  );
}
