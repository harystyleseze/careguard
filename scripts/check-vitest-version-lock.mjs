#!/usr/bin/env node
/**
 * Ensures `vitest` and `@vitest/coverage-v8` stay version-locked (issue #1395).
 *
 * `@vitest/coverage-v8` must be published against the exact `vitest` version it
 * instruments, but the two declared as independent `^` ranges can drift apart on
 * a routine `npm update` (each range resolves to the newest matching release,
 * which is not guaranteed to be identical). This script fails CI if either the
 * declared specifiers or the lockfile-resolved versions diverge.
 *
 * When upgrading vitest, always bump both packages together:
 *   @vitest/coverage-v8  vitest
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
const dashboardPkg = JSON.parse(
  readFileSync(join(repoRoot, "dashboard", "package.json"), "utf8"),
);

const errors = [];
const tasks = [
  {
    label: "root package.json",
    spec: pkg.devDependencies.vitest,
    coverage: pkg.devDependencies["@vitest/coverage-v8"],
  },
  {
    label: "dashboard/package.json",
    spec: dashboardPkg.devDependencies.vitest,
    coverage: dashboardPkg.devDependencies["@vitest/coverage-v8"],
  },
];

for (const { label, spec, coverage } of tasks) {
  if (spec !== coverage) {
    errors.push(
      `${label}: declared specifiers differ — vitest=${spec} vs @vitest/coverage-v8=${coverage}`,
    );
  }
}

const resolvedVitest = lock.packages?.["node_modules/vitest"]?.version;
const resolvedCoverage = lock.packages?.["node_modules/@vitest/coverage-v8"]?.version;
if (!resolvedVitest || !resolvedCoverage) {
  errors.push(
    "package-lock.json is missing resolved node_modules/vitest or node_modules/@vitest/coverage-v8",
  );
} else if (resolvedVitest !== resolvedCoverage) {
  errors.push(
    `lockfile: resolved versions differ — vitest=${resolvedVitest} vs @vitest/coverage-v8=${resolvedCoverage}`,
  );
}

if (errors.length > 0) {
  console.error("[check:vitest-lock] FAILED:");
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    "\nvitest and @vitest/coverage-v8 MUST be upgraded together to the same release.",
  );
  process.exit(1);
}

console.log(
  `[check:vitest-lock] OK — vitest=${resolvedVitest} and @vitest/coverage-v8=${resolvedCoverage} are version-locked`,
);