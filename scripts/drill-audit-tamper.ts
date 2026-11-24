/**
 * Game-day drill helper — creates a temporary copy of audit.log.jsonl and
 * mutates one entry to break the cryptographic hash chain (#959).
 *
 * NEVER modifies the live data/audit.log.jsonl file.
 *
 * Usage:
 *   npx tsx scripts/drill-audit-tamper.ts
 *   npx tsx scripts/drill-audit-tamper.ts --out /tmp/drill-audit.log.jsonl
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { canonicalize } from "../shared/audit-log.ts";

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_SOURCE = fileURLToPath(new URL("../data/audit.log.jsonl", import.meta.url));

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

function buildSyntheticLog(): string[] {
  const events = [
    { timestamp: "2026-01-01T00:00:00.000Z", action: "system.boot", actor: "drill", amountUsd: 0 },
    { timestamp: "2026-01-01T00:01:00.000Z", action: "bill.audit", actor: "agent", amountUsd: 125.5 },
    { timestamp: "2026-01-01T00:02:00.000Z", action: "payment.settled", actor: "agent", amountUsd: 125.5 },
  ];

  let prevHash = GENESIS_HASH;
  return events.map((payload) => {
    const hash = createHash("sha256")
      .update(prevHash + canonicalize(payload))
      .digest("hex");
    const line = JSON.stringify({ ...payload, prevHash, hash });
    prevHash = hash;
    return line;
  });
}

function main(): void {
  const sourcePath = resolve(parseArg("--source") || DEFAULT_SOURCE);
  const outArg = parseArg("--out");
  const outPath = resolve(
    outArg || join(tmpdir(), `careguard-audit-drill-${Date.now()}`, "audit.log.jsonl"),
  );

  if (outPath === DEFAULT_SOURCE) {
    console.error("Refusing to overwrite live data/audit.log.jsonl. Specify a temporary --out path.");
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });

  let lines: string[] = [];
  if (existsSync(sourcePath)) {
    copyFileSync(sourcePath, outPath);
    lines = readFileSync(outPath, "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "");
  }

  if (lines.length === 0) {
    lines = buildSyntheticLog();
  }

  // Mutate the middle entry (or first if only 1) without recomputing `hash`
  const targetIndex = Math.floor(lines.length / 2);
  const parsed = JSON.parse(lines[targetIndex]) as Record<string, unknown>;
  parsed.drillTampered = true;
  lines[targetIndex] = JSON.stringify(parsed);

  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf-8");

  console.log(`Prepared tampered audit log copy (${lines.length} entries) at:`);
  console.log(`  ${outPath}`);
  console.log(`Mutated entry: line ${targetIndex + 1} (index ${targetIndex})`);
  console.log("");
  console.log("Run the verifier cold as on-call and start the TTD timer:");
  console.log(`  AUDIT_FILE=${outPath} npx tsx scripts/verify-audit-log.ts`);
}

main();
