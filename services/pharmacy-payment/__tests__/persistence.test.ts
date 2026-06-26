import { mkdtempSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileBackedMppStore,
  loadOrders,
  saveOrder,
} from "../persistence.ts";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "careguard-mpp-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("pharmacy payment persistence (#200)", () => {
  it("keeps confirmed orders queryable after a restart", async () => {
    const ordersFile = join(testDir, "orders.json");
    const order = {
      id: "order-restart-1",
      drug: "atorvastatin",
      pharmacy: "Care Pharmacy",
      amount: 12.5,
      status: "confirmed",
    };

    await saveOrder(ordersFile, order);

    expect(loadOrders(ordersFile)).toEqual([order]);
  });

  it("writes orders with temp-file rename cleanup", async () => {
    const ordersFile = join(testDir, "orders.json");

    await saveOrder(ordersFile, { id: "order-atomic-1" });

    expect(loadOrders(ordersFile)).toEqual([{ id: "order-atomic-1" }]);
    expect(readdirSync(testDir).some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("persists MPP store values across store instances", async () => {
    const storeFile = join(testDir, "mpp-store.json");
    const beforeRestart = createFileBackedMppStore(storeFile);

    await beforeRestart.put("challenge:abc", {
      status: "settled",
      orderId: "order-abc",
    });

    const afterRestart = createFileBackedMppStore(storeFile);

    await expect(afterRestart.get("challenge:abc")).resolves.toEqual({
      status: "settled",
      orderId: "order-abc",
    });
  });

  it("persists atomic MPP store updates across restarts", async () => {
    const storeFile = join(testDir, "mpp-store.json");
    const beforeRestart = createFileBackedMppStore(storeFile);

    await beforeRestart.update("attempts", (current: any) => ({
      op: "set",
      value: { count: (current?.count ?? 0) + 1 },
      result: "stored",
    }));

    const afterRestart = createFileBackedMppStore(storeFile);

    await expect(afterRestart.get("attempts")).resolves.toEqual({ count: 1 });
  });
});
