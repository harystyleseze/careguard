import { createRequire } from "module";
import { dirname } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";

type ReleaseLock = () => Promise<void> | void;
type ReleaseLockSync = () => void;

const require = createRequire(import.meta.url);
const lock = require("proper-lockfile") as {
  lock: (
    filePath: string,
    options?: {
      retries?:
        | number
        | {
            retries: number;
            factor?: number;
            minTimeout?: number;
            maxTimeout?: number;
          };
      stale?: number;
      realpath?: boolean;
    },
  ) => Promise<ReleaseLock>;
  lockSync: (
    filePath: string,
    options?: { stale?: number; realpath?: boolean },
  ) => ReleaseLockSync;
};

const ASYNC_LOCK_OPTIONS = {
  retries: { retries: 200, factor: 1, minTimeout: 1, maxTimeout: 10 },
  stale: 5000,
  realpath: false,
};

const SYNC_LOCK_OPTIONS = { stale: 5000, realpath: false };

function ensureParentDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function tempPathFor(filePath: string) {
  return `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

export function writeJsonFileAtomic(filePath: string, value: unknown) {
  ensureParentDir(filePath);
  const tempFile = tempPathFor(filePath);
  writeFileSync(tempFile, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tempFile, filePath);
}

export function writeTextFileAtomic(filePath: string, value: string) {
  ensureParentDir(filePath);
  const tempFile = tempPathFor(filePath);
  writeFileSync(tempFile, value, "utf-8");
  renameSync(tempFile, filePath);
}

export async function withJsonFileLock<TData, TResult>(
  filePath: string,
  fallback: TData,
  fn: (data: TData) => TResult | Promise<TResult>,
): Promise<TResult> {
  ensureParentDir(filePath);
  const release = await lock.lock(filePath, ASYNC_LOCK_OPTIONS);
  try {
    const data = readJsonFile<TData>(filePath, fallback);
    return await fn(data);
  } finally {
    await release();
  }
}

export function withJsonFileLockSync<TData, TResult>(
  filePath: string,
  fallback: TData,
  fn: (data: TData) => TResult,
): TResult {
  ensureParentDir(filePath);
  const release = lock.lockSync(filePath, SYNC_LOCK_OPTIONS);
  try {
    const data = readJsonFile<TData>(filePath, fallback);
    return fn(data);
  } finally {
    release();
  }
}

export async function appendJsonArrayItem<T>(
  filePath: string,
  item: T,
): Promise<T[]> {
  return await withJsonFileLock<T[], T[]>(filePath, [], (data) => {
    const items = Array.isArray(data) ? data : [];
    items.push(item);
    writeJsonFileAtomic(filePath, items);
    return items;
  });
}

export function writeJsonFileAtomicLocked<T>(filePath: string, value: T): void {
  withJsonFileLockSync(filePath, value, () => {
    writeJsonFileAtomic(filePath, value);
  });
}
