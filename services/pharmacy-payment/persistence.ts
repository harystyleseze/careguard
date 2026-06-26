import { dirname } from "path";
import { createRequire } from "module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { Store } from "mppx/server";

type JsonObject = Record<string, unknown>;
type ReleaseLock = () => Promise<void> | void;

const require = createRequire(import.meta.url);
const lock = require("proper-lockfile") as {
  lock: (
    filePath: string,
    options?: { retries?: number; stale?: number },
  ) => Promise<ReleaseLock>;
};

function ensureParentDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function atomicWriteJson(filePath: string, value: unknown) {
  ensureParentDir(filePath);
  const tempFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempFile, filePath);
}

function ensureJsonFile(filePath: string, fallback: unknown) {
  ensureParentDir(filePath);
  if (!existsSync(filePath)) {
    atomicWriteJson(filePath, fallback);
  }
}

async function withJsonFileLock<TData, TResult>(
  filePath: string,
  fallback: TData,
  fn: (data: TData) => TResult | Promise<TResult>,
): Promise<TResult> {
  ensureJsonFile(filePath, fallback);
  const release = await lock.lock(filePath, { retries: 10, stale: 5000 });
  try {
    const data = readJsonFile<TData>(filePath, fallback);
    return await fn(data);
  } finally {
    await release();
  }
}

export function loadOrders(filePath: string): any[] {
  return readJsonFile<any[]>(filePath, []);
}

export async function saveOrder(filePath: string, order: any) {
  await withJsonFileLock(filePath, [] as any[], (data) => {
    const orders = Array.isArray(data) ? data : [];
    orders.push(order);
    atomicWriteJson(filePath, orders);
  });
}

export function createFileBackedMppStore(filePath: string): ReturnType<typeof Store.memory> {
  ensureJsonFile(filePath, {});

  return Store.from({
    async get(key) {
      const data = readJsonFile<JsonObject>(filePath, {});
      return Object.prototype.hasOwnProperty.call(data, key)
        ? (data[key] as any)
        : null;
    },
    async put(key, value) {
      await withJsonFileLock(filePath, {} as JsonObject, (data) => {
        data[key] = value;
        atomicWriteJson(filePath, data);
      });
    },
    async delete(key) {
      await withJsonFileLock(filePath, {} as JsonObject, (data) => {
        delete data[key];
        atomicWriteJson(filePath, data);
      });
    },
    async update(key, fn) {
      return await withJsonFileLock(filePath, {} as JsonObject, (data) => {
        const current = Object.prototype.hasOwnProperty.call(data, key)
          ? (data[key] as never)
          : null;
        const change = fn(current);
        if (change.op === "set") data[key] = change.value;
        if (change.op === "delete") delete data[key];
        if (change.op !== "noop") atomicWriteJson(filePath, data);
        return change.result;
      });
    },
  });
}
