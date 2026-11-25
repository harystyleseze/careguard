#!/usr/bin/env tsx
/**
 * #974: Verifies that docs/runbooks/README.md index and the actual
 * files under docs/runbooks/ stay in sync. Fails on:
 *   - Index links pointing to files that don't exist
 *   - Files in docs/runbooks/ not listed in the Index
 *
 * #973: Also checks last-verified freshness — flags runbooks without
 * a "Last verified:" header or with one older than the threshold.
 *
 * #972: Convention for the header is:
 *   <!-- Last verified: YYYY-MM-DD -->
 *  placed in the first 5 lines of each runbook.
 *
 * Usage: tsx scripts/check-runbook-index.ts [--max-age-days=180]
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const runbooksDir = join(__dirname, "..", "docs", "runbooks");
const maxAgeDays = Number(process.argv.find((a) => a.startsWith("--max-age-days="))?.split("=")[1] ?? 180);

// 1. Parse the index table from README.md
const readme = readFileSync(join(runbooksDir, "README.md"), "utf8");
const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
const indexedFiles = new Set<string>();
let match: RegExpExecArray | null;
while ((match = linkRe.exec(readme)) !== null) {
  const href = match[2];
  if (href.endsWith(".md") && !href.startsWith("http")) {
    indexedFiles.add(href);
  }
}

// 2. Check that every indexed file exists
let failed = false;
for (const file of indexedFiles) {
  if (!existsSync(join(runbooksDir, file))) {
    console.error(`❌ MISSING: Index references ${file} but file does not exist`);
    failed = true;
  }
}

// 3. Check that every .md file in the directory is indexed
const actualFiles = readdirSync(runbooksDir)
  .filter((f) => f.endsWith(".md") && f !== "README.md");
for (const file of actualFiles) {
  if (!indexedFiles.has(file)) {
    console.error(`❌ UNINDEXED: ${file} exists but is not in the Index table`);
    failed = true;
  }
}

// 4. #972/#973: Check last-verified freshness
const now = Date.now();
const thresholdMs = maxAgeDays * 24 * 60 * 60 * 1000;
for (const file of actualFiles) {
  const content = readFileSync(join(runbooksDir, file), "utf8");
  const headerMatch = content.match(/Last verified:\s*(\d{4}-\d{2}-\d{2})/);
  if (!headerMatch) {
    console.warn(`⚠️  NO HEADER: ${file} has no "Last verified:" header`);
    continue;
  }
  const verifiedDate = new Date(headerMatch[1]).getTime();
  const ageMs = now - verifiedDate;
  if (ageMs > thresholdMs) {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    console.warn(`⚠️  STALE: ${file} last verified ${days} days ago (threshold: ${maxAgeDays} days)`);
  }
}

if (failed) {
  console.error("\n❌ Runbook index check FAILED — fix the issues above.");
  process.exit(1);
}
console.log("✅ Runbook index is in sync and freshness check complete.");
