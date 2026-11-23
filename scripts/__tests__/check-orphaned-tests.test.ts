import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOrphanedTests } from "../check-orphaned-tests.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("check-orphaned-tests (Issue #994)", () => {
  it("verifies that all current test files in repository match vitest include globs", async () => {
    const result = await findOrphanedTests({ repoRoot });
    expect(result.total).toBeGreaterThan(0);
    expect(result.orphaned).toEqual([]);
    expect(result.matched.length).toBe(result.total);
    // Explicitly confirm agent/tools.test.ts is matched (#992 / #994)
    expect(result.matched).toContain("agent/tools.test.ts");
  });

  it("regression: detects deliberately misplaced test files as orphaned", async () => {
    const mockFiles = [
      "agent/tools.test.ts",
      "services/care-recipients/__tests__/caregivers.test.ts",
      "services/orphaned-service.test.ts", // Deliberately misplaced outside __tests__/
      "stray-folder/bad-location.test.ts",  // Deliberately misplaced in unconfigured folder
    ];

    const result = await findOrphanedTests({
      repoRoot,
      candidateFiles: mockFiles,
    });

    expect(result.total).toBe(4);
    expect(result.matched).toEqual([
      "agent/tools.test.ts",
      "services/care-recipients/__tests__/caregivers.test.ts",
    ]);
    expect(result.orphaned).toEqual([
      "services/orphaned-service.test.ts",
      "stray-folder/bad-location.test.ts",
    ]);
  });

  it("regression: proves agent/tools.test.ts would be caught by old include globs", async () => {
    const oldIncludeGlobs = [
      "agent/**/__tests__/**/*.test.{ts,tsx}",
      "agent/**/evals/**/*.spec.{ts,tsx}",
      "services/**/__tests__/**/*.test.{ts,tsx}",
      "shared/**/__tests__/**/*.test.{ts,tsx}",
      "scripts/**/__tests__/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ];

    const result = await findOrphanedTests({
      repoRoot,
      includeGlobs: oldIncludeGlobs,
      candidateFiles: ["agent/tools.test.ts", "agent/__tests__/runner.test.ts"],
    });

    expect(result.orphaned).toContain("agent/tools.test.ts");
    expect(result.matched).toContain("agent/__tests__/runner.test.ts");
  });
});

