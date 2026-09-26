/**
 * Audit log scaling benchmark (#1290).
 *
 * Question: how do appendAuditEntry / getLastLine / the GET /agent/audit read
 * path degrade as audit.log.jsonl grows, and is a database warranted yet?
 *
 * Seeding is done with a direct bulk write rather than through
 * appendAuditEntry: at ~300 appends/s (measured) driving 1M entries through the
 * real path would take the better part of an hour and would tell us nothing we
 * cannot learn by appending a sample on top of a pre-sized file. Each size is
 * therefore seeded to N entries, then the operations are measured at that size.
 *
 * getLastLine() is included because the issue calls it out as a full-file read.
 * It is not one — it seeks backwards from the tail in 1 KiB chunks — so the
 * table shows it staying flat, and adds the read path that genuinely is O(n)
 * (the GET /agent/audit handler) for contrast.
 *
 * Rotation is measured separately at every size, including the production case
 * where the active file is pinned at MAX_FILE_SIZE by rotateLogs() on every
 * append.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

const ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
const DEFAULT_ENTRY_COUNTS = [10_000, 100_000, 1_000_000];
const APPEND_SAMPLES = 200;
const LAST_LINE_SAMPLES = 200;
const QUERY_SAMPLES = 3;

interface Stats {
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

interface SizeResult {
  entries: number;
  bytes: number;
  append: Stats;
  appendPerSecond: number;
  lastLine: Stats;
  query: Stats;
  rotationMs: number;
  rotationDuringAppends: number;
  activeBytesAfterAppends: number;
  rotationArchivesAfter: number;
  queryPeakRssMb: number;
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function entryCounts(): number[] {
  const values = (process.env.AUDIT_ENTRIES ?? DEFAULT_ENTRY_COUNTS.join(","))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return values.length > 0 ? values : DEFAULT_ENTRY_COUNTS;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function stats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

function measure(samples: number, operation: () => void): Stats {
  const values: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    operation();
    values.push(performance.now() - started);
  }
  return stats(values);
}

function formatMs(value: number): string {
  return value.toFixed(3).padStart(9);
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Bulk-write `entries` chained JSONL records straight to disk, bypassing
 * appendAuditEntry (and therefore rotateLogs) so the active file can be grown
 * past the 10 MB rotation threshold. The hash chain is reproduced exactly as
 * appendAuditEntry builds it, so a subsequent real append links onto the last
 * seeded record rather than falling back to the genesis hash.
 */
function seedActiveFile(auditFile: string, entries: number): void {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  let prevHash = "0".repeat(64);
  const CHUNK = 2_000;
  writeFileSync(auditFile, "", "utf-8");

  for (let start = 0; start < entries; start += CHUNK) {
    let block = "";
    const end = Math.min(start + CHUNK, entries);
    for (let index = start; index < end; index++) {
      const payload = {
        timestamp: new Date(base + index * 1000).toISOString(),
        event: "benchmark.entry",
        actor: "benchmark",
        details: { index, kind: "scaling" },
      };
      // canonicalize() sorts object keys, which this literal already does.
      const serialized = JSON.stringify({
        details: payload.details,
        actor: payload.actor,
        event: payload.event,
        timestamp: payload.timestamp,
      });
      const hash = createHash("sha256")
        .update(prevHash + serialized)
        .digest("hex");
      block += JSON.stringify({ ...payload, prevHash, hash }) + "\n";
      prevHash = hash;
    }
    appendFileSync(auditFile, block, "utf-8");
  }
}

/** Replicates the work GET /agent/audit does for one page of results. */
function queryAuditRoute(auditFile: string): number {
  const fileContent = readFileSync(auditFile, "utf-8");
  const lines = fileContent.trim().split("\n");
  const logs: Array<{ timestamp: string }> = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      logs.push(JSON.parse(line));
    } catch {
      // Matches the handler, which skips malformed lines.
    }
  }
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return logs.slice(0, 50).length;
}

function countArchives(auditFile: string): number {
  const dir = auditFile.slice(0, auditFile.lastIndexOf("/") + 1);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.startsWith("audit.log.jsonl.")).length;
}

async function measureSize(
  audit: {
    appendAuditEntry: (entry: { event: string; actor: string; details: Record<string, unknown> }) => void;
    getLastLine: (filePath: string) => string | null;
    getAuditFilePath: () => string;
  },
  root: string,
  entries: number,
): Promise<SizeResult> {
  // --- Steady-state size: active file grown to `entries` with rotation bypassed.
  const sizeDir = join(root, `size-${entries}`);
  process.env.DATA_DIR = sizeDir;
  mkdirSync(sizeDir, { recursive: true });
  const auditFile = audit.getAuditFilePath();
  seedActiveFile(auditFile, entries);
  const bytes = statSync(auditFile).size;

  // Read paths are measured FIRST, on the untouched full-size file. Once an
  // append runs, rotateLogs() sees size >= MAX_FILE_SIZE and renames the file
  // away, so any read measured afterwards would see a nearly empty file.
  const lastLine = measure(LAST_LINE_SAMPLES, () => {
    void audit.getLastLine(auditFile);
  });

  let queryPeakRssMb = 0;
  const query = measure(QUERY_SAMPLES, () => {
    queryAuditRoute(auditFile);
    queryPeakRssMb = Math.max(queryPeakRssMb, process.memoryUsage().rss / 1024 / 1024);
  });

  // --- Append cost at this size. Above MAX_FILE_SIZE the first append pays a
  // full rotation cascade, which is recorded separately as rotationMs below.
  const appendTimings: number[] = [];
  let rotationDuringAppends = 0;
  const appendStarted = performance.now();
  for (let i = 0; i < APPEND_SAMPLES; i++) {
    const before = existsSync(`${auditFile}.1`) ? 1 : 0;
    const started = performance.now();
    audit.appendAuditEntry({
      event: "benchmark.append",
      actor: "benchmark",
      details: { index: entries + i, kind: "steady" },
    });
    appendTimings.push(performance.now() - started);
    if (existsSync(`${auditFile}.1`) && before === 0) rotationDuringAppends++;
  }
  const appendWallMs = performance.now() - appendStarted;
  const activeBytesAfterAppends = statSync(auditFile).size;

  // --- Rotation cost, measured on a file already at the threshold.
  const rotationDir = join(root, `rotation-${entries}`);
  process.env.DATA_DIR = rotationDir;
  mkdirSync(rotationDir, { recursive: true });
  const rotationFile = audit.getAuditFilePath();
  writeFileSync(rotationFile, Buffer.alloc(ROTATION_THRESHOLD_BYTES + 1, 32));
  const rotationStarted = performance.now();
  audit.appendAuditEntry({
    event: "benchmark.rotation",
    actor: "benchmark",
    details: { entries },
  });
  const rotationMs = performance.now() - rotationStarted;
  const rotationArchivesAfter = countArchives(rotationFile);

  rmSync(sizeDir, { recursive: true, force: true });
  rmSync(rotationDir, { recursive: true, force: true });

  return {
    entries,
    bytes,
    append: stats(appendTimings),
    appendPerSecond: appendWallMs > 0 ? (APPEND_SAMPLES / appendWallMs) * 1_000 : 0,
    lastLine,
    query,
    rotationMs,
    rotationDuringAppends,
    activeBytesAfterAppends,
    rotationArchivesAfter,
    queryPeakRssMb,
  };
}

/**
 * The production bound: rotateLogs() runs on every append, so the active file
 * is pinned near MAX_FILE_SIZE no matter how many entries are written in total.
 */
function measureProductionBound(
  audit: { appendAuditEntry: (entry: { event: string; actor: string; details: Record<string, unknown> }) => void; getAuditFilePath: () => string },
  root: string,
): void {
  const dir = join(root, "production-bound");
  process.env.DATA_DIR = dir;
  mkdirSync(dir, { recursive: true });
  const auditFile = audit.getAuditFilePath();

  // ~268 bytes/entry measured, so ~39k appends fills one 10 MB file. 45k is
  // enough to cross the threshold once and show the active file pinned.
  const total = positiveEnv("PRODUCTION_BOUND_APPENDS", 45_000);
  const started = performance.now();
  for (let i = 0; i < total; i++) {
    audit.appendAuditEntry({
      event: "benchmark.production",
      actor: "benchmark",
      details: { index: i },
    });
  }
  const wallMs = performance.now() - started;
  const activeBytes = statSync(auditFile).size;
  const archives = countArchives(auditFile);
  const activeLines = readFileSync(auditFile, "utf-8").trim().split("\n").length;

  console.log(
    `\nProduction bound — ${total.toLocaleString()} appends with rotation enabled: ` +
      `active file ${formatBytes(activeBytes)} (${activeLines.toLocaleString()} entries), ` +
      `${archives} archive(s), ${(wallMs / 1000).toFixed(1)} s total, ` +
      `${((total / wallMs) * 1000).toFixed(0)} appends/s.`,
  );
  rmSync(dir, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "careguard-audit-benchmark-"));
  const previousDataDir = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = root;
    const audit = await import("../shared/audit-log.ts");
    const results: SizeResult[] = [];
    for (const entries of entryCounts()) {
      process.stderr.write(`seeding ${entries.toLocaleString()} entries...\n`);
      results.push(await measureSize(audit, root, entries));
    }

    console.log(`\nAudit log scaling benchmark (#1290)`);
    console.log(`Node ${process.version} | ${APPEND_SAMPLES} append samples per size`);
    console.log(
      `| entries | active size | append mean ms | append p95 ms | append p99 ms | append/s | getLastLine p95 ms | GET /agent/audit p95 ms | read peak RSS MiB | rotation ms | rotations during 200 appends |`,
    );
    console.log(`|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
    for (const result of results) {
      console.log(
        `| ${result.entries.toLocaleString()} | ${formatBytes(result.bytes)} | ${formatMs(result.append.mean)} | ${formatMs(result.append.p95)} | ${formatMs(result.append.p99)} | ${result.appendPerSecond.toFixed(0)} | ${formatMs(result.lastLine.p95)} | ${formatMs(result.query.p95)} | ${result.queryPeakRssMb.toFixed(0)} | ${formatMs(result.rotationMs)} | ${result.rotationDuringAppends} |`,
      );
    }
    console.log(
      `\nSamples per size: ${APPEND_SAMPLES} append, ${LAST_LINE_SAMPLES} getLastLine, ${QUERY_SAMPLES} GET /agent/audit.`,
    );
    console.log(`Rotation threshold: ${formatBytes(ROTATION_THRESHOLD_BYTES)} (MAX_FILE_SIZE).`);

    if (process.env.SKIP_PRODUCTION_BOUND !== "1") {
      measureProductionBound(audit, root);
    }
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
