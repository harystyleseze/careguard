import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { Server } from "http";
import { tmpdir } from "os";
import path from "path";

const testState = { ordersFile: "", failRename: false };

vi.mock("mppx/server", () => ({
  Store: { memory: vi.fn(() => ({})), fileSystem: vi.fn(() => ({})) },
  Mppx: { create: vi.fn(() => ({})) },
}));
vi.mock("@stellar/mpp/charge/server", () => ({ stellar: { charge: vi.fn(() => ({})) } }));
vi.mock("@stellar/mpp", () => ({ USDC_SAC_TESTNET: "USDC_SAC_TESTNET" }));
vi.mock("dotenv/config", () => ({}));
vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("proper-lockfile", () => ({
  default: { lock: vi.fn(async () => async () => {}) },
}));
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(async (source: string, destination: string) => {
      if (
        testState.failRename &&
        path.normalize(destination) === testState.ordersFile
      ) {
        throw new Error("simulated rename failure");
      }
      return actual.rename(source, destination);
    }),
  };
});

let dataDir: string;
let server: Server;
let saveOrder: typeof import("../server.ts")["saveOrder"];

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "careguard-save-order-"));
  testState.ordersFile = path.join(dataDir, "orders.json");
  writeFileSync(
    testState.ordersFile,
    JSON.stringify([{ id: "existing-order", drug: "Amoxicillin" }], null, 2),
    "utf-8",
  );

  process.env.DATA_DIR = dataDir;
  process.env.PHARMACY_1_PUBLIC_KEY = "GPUBTESTSAVEORDER";
  process.env.MPP_SECRET_KEY = "test-mpp-secret";
  process.env.PHARMACY_PAYMENT_PORT = "0";

  const mod = await import("../server.ts");
  saveOrder = mod.saveOrder;
  server = mod.server;
});

afterAll(() => {
  server?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("saveOrder atomic write failure (Issue #939)", () => {
  it("leaves the existing orders file untouched and rethrows when rename fails", async () => {
    const before = readFileSync(testState.ordersFile, "utf-8");
    testState.failRename = true;

    await expect(saveOrder({ id: "new-order" })).rejects.toThrow(
      "simulated rename failure",
    );

    expect(readFileSync(testState.ordersFile, "utf-8")).toBe(before);
    testState.failRename = false;
  });
});
