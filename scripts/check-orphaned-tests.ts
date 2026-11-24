#!/usr/bin/env tsx
/**
 * Orphaned Test Guard (Issue #994)
 *
 * Ensures all *.test.ts, *.test.tsx, *.spec.ts, *.spec.tsx files in the codebase
 * are captured by vitest's configured `include` globs in vitest.config.ts.
 *
 * Prevents test files from silently rotting or being excluded from CI.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { glob } from "glob";
import picomatch from "picomatch";
import vitestConfig from "../vitest.config.ts";

export const TEST_FILE_PATTERNS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
];

export const EXCLUDE_PATTERNS = [
  "**/node_modules/**",
  "**/.git/**",
  "dashboard/**", // Managed independently by dashboard/vitest.config.ts
  "e2e/**",       // Playwright end-to-end tests
  "dist/**",
  "build/**",
];

export interface CheckOrphanedTestsOptions {
  repoRoot?: string;
  includeGlobs?: string[];
  candidateFiles?: string[];
}

export interface CheckResult {
  total: number;
  orphaned: string[];
  matched: string[];
}

/**
 * Identify test files not covered by vitest's include configuration.
 *
 * Complexity:
 * - Time: O(N * K) where N is test file count, K is path length.
 * - Space: O(N) memory for paths and matcher state.
 */
export async function findOrphanedTests(
  options: CheckOrphanedTestsOptions = {},
): Promise<CheckResult> {
  const rootDir =
    options.repoRoot ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const includeGlobs =
    options.includeGlobs ?? (vitestConfig.test?.include || []);

  const matcher = picomatch(includeGlobs, { dot: true });

  let files: string[];
  if (options.candidateFiles) {
    files = options.candidateFiles;
  } else {
    files = await glob(TEST_FILE_PATTERNS, {
      cwd: rootDir,
      ignore: EXCLUDE_PATTERNS,
      posix: true,
    });
  }

  const orphaned: string[] = [];
  const matched: string[] = [];

  for (const file of files) {
    const relPath = path.isAbsolute(file)
      ? path.relative(rootDir, file).split(path.sep).join("/")
      : file.split(path.sep).join("/");

    if (matcher(relPath)) {
      matched.push(relPath);
    } else {
      orphaned.push(relPath);
    }
  }

  return {
    total: files.length,
    orphaned,
    matched,
  };
}

export async function runCheck(): Promise<void> {
  const result = await findOrphanedTests();

  if (result.orphaned.length > 0) {
    console.error(
      `\x1b[31m[ERROR] Found ${result.orphaned.length} orphaned test file(s) outside vitest include globs:\x1b[0m`,
    );
    for (const file of result.orphaned) {
      console.error(`  - ${file}`);
    }
    console.error(
      "\nPlease either update vitest.config.ts include globs or relocate these test files so CI executes them.",
    );
    process.exit(1);
  }

  console.log(
    `\x1b[32m[OK] All ${result.total} test file(s) match vitest include globs.\x1b[0m`,
  );
}

const entrypointUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === entrypointUrl) {
  runCheck().catch((err) => {
    console.error("Failed to check orphaned tests:", err);
    process.exit(1);
  });
}

