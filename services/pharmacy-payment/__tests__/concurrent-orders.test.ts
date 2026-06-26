import { mkdtempSync, readFileSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonArrayItem,
  readJsonFile,
} from "../../../shared/atomic-json.ts";

let testDir: string;
let ordersFile: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "careguard-orders-"));
  ordersFile = join(testDir, "orders.json");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("Pharmacy Payment - atomic order saving (#203)", () => {
  it("preserves all 100 parallel order writes", async () => {
    await Promise.all(
      Array.from({ length: 100 }, (_unused, index) =>
        appendJsonArrayItem(ordersFile, {
          id: `order-${index}`,
          drug: `drug-${index}`,
          pharmacy: `pharmacy-${index % 5}`,
          amount: index + 1,
          status: "confirmed",
          timestamp: new Date(0).toISOString(),
        }),
      ),
    );

    const savedOrders = readJsonFile<any[]>(ordersFile, []);
    const ids = new Set(savedOrders.map((order) => order.id));

    expect(savedOrders).toHaveLength(100);
    expect(ids.size).toBe(100);
  });

  it("keeps intermediate reads parseable while writes are in flight", async () => {
    const writes = Array.from({ length: 100 }, (_unused, index) =>
      appendJsonArrayItem(ordersFile, { id: `order-${index}` }),
    );
    const reads = Array.from({ length: 100 }, async () => {
      try {
        JSON.parse(readFileSync(ordersFile, "utf-8"));
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }
    });

    await Promise.all([...writes, ...reads]);

    expect(readJsonFile<any[]>(ordersFile, [])).toHaveLength(100);
  });

  it("uses temp-file promotion without leaving temp files behind", async () => {
    await appendJsonArrayItem(ordersFile, { id: "order-atomic-1" });

    expect(readJsonFile<any[]>(ordersFile, [])).toEqual([
      { id: "order-atomic-1" },
    ]);
    expect(readdirSync(testDir).some((name) => name.includes(".tmp-"))).toBe(false);
  });
});
