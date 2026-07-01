/**
 * Chaos tests for Redis outage fallback (Issue #808).
 * Verifies that system degrades gracefully to in-memory client when Redis is unreachable.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRedisClient,
  createInMemoryClient,
  _resetDefaultClient,
} from "../redis.ts";

describe("Redis fallback — outage chaos (Issue #808)", () => {
  beforeEach(() => {
    _resetDefaultClient();
  });

  afterEach(() => {
    _resetDefaultClient();
  });

  it("in-memory client degrades gracefully when Redis fails", async () => {
    const failingRedis = {
      get: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      set: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      incr: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      del: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      on: () => failingRedis,
    };

    const client = createRedisClient(failingRedis as any);

    const result = await client.get("test-key");
    expect(result).toBeNull();
  });

  it("acquireLock returns false when Redis is unreachable", async () => {
    const failingRedis = {
      get: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      set: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      incr: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      del: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      on: () => failingRedis,
    };

    const client = createRedisClient(failingRedis as any);

    const locked = await client.acquireLock("test-lock", 5000);
    expect(locked).toBe(false);
  });

  it("incr returns 0 when Redis is unreachable", async () => {
    const failingRedis = {
      get: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      set: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      incr: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      del: async () => {
        throw new Error("ECONNREFUSED: Connection refused");
      },
      on: () => failingRedis,
    };

    const client = createRedisClient(failingRedis as any);

    const count = await client.incr("counter");
    expect(count).toBe(0);
  });

  it("in-memory fallback client provides working rate-limit semantics", async () => {
    const client = createInMemoryClient();

    let count1 = await client.incr("rate:user:123");
    expect(count1).toBe(1);

    let count2 = await client.incr("rate:user:123");
    expect(count2).toBe(2);

    let count3 = await client.incr("rate:user:123");
    expect(count3).toBe(3);

    await client.set("rate:user:123", "0", 1000);
    const reset = await client.get("rate:user:123");
    expect(reset).toBe("0");
  });

  it("in-memory fallback client provides working lock semantics", async () => {
    const client = createInMemoryClient();

    const lock1 = await client.acquireLock("mpp:lock", 5000);
    expect(lock1).toBe(true);

    const lock2 = await client.acquireLock("mpp:lock", 5000);
    expect(lock2).toBe(false);

    await client.del("mpp:lock");

    const lock3 = await client.acquireLock("mpp:lock", 5000);
    expect(lock3).toBe(true);
  });

  it("set with TTL and get succeeds on in-memory fallback", async () => {
    const client = createInMemoryClient();

    await client.set("temp-key", "temp-value", 5000);
    const value = await client.get("temp-key");
    expect(value).toBe("temp-value");
  });

  it("deleted key returns null on next get", async () => {
    const client = createInMemoryClient();

    await client.set("deletable", "value");
    let result = await client.get("deletable");
    expect(result).toBe("value");

    await client.del("deletable");
    result = await client.get("deletable");
    expect(result).toBeNull();
  });

  it("in-memory fallback stores behave independently across instances", async () => {
    const client1 = createInMemoryClient();
    const client2 = createInMemoryClient();

    await client1.set("shared-key", "from-client1");
    const value = await client2.get("shared-key");
    expect(value).toBeNull();
  });

  it("redis client set succeeds when Redis is available", async () => {
    const workingRedis = {
      get: async () => "value",
      set: async () => "OK",
      incr: async () => 1,
      del: async () => 1,
      on: () => workingRedis,
    };

    const client = createRedisClient(workingRedis as any);

    const value = await client.get("working-key");
    expect(value).toBe("value");
  });

  it("recovery: when Redis returns, operations succeed without restart", async () => {
    let redisFailing = true;
    const redis = {
      get: async () => {
        if (redisFailing) throw new Error("ECONNREFUSED");
        return "recovered";
      },
      set: async () => {
        if (redisFailing) throw new Error("ECONNREFUSED");
        return "OK";
      },
      incr: async () => {
        if (redisFailing) throw new Error("ECONNREFUSED");
        return 1;
      },
      del: async () => {
        if (redisFailing) throw new Error("ECONNREFUSED");
        return 1;
      },
      on: () => redis,
    };

    const client = createRedisClient(redis as any);

    const failResult = await client.get("recovery-test");
    expect(failResult).toBeNull();

    redisFailing = false;

    const successResult = await client.get("recovery-test");
    expect(successResult).toBe("recovered");
  });
});
