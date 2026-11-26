import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { runQuarterlyRotationDrill } from "../drill-rotate-secrets.ts";

describe("Quarterly secret-rotation calendar drill (Issue #966)", () => {
  let tempDir: string;
  let origAuditFile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "careguard-rotate-drill-"));
    origAuditFile = process.env.AUDIT_LOG_FILE;
    process.env.AUDIT_LOG_FILE = path.join(tempDir, "audit.log.jsonl");
  });

  afterEach(() => {
    if (origAuditFile === undefined) delete process.env.AUDIT_LOG_FILE;
    else process.env.AUDIT_LOG_FILE = origAuditFile;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rehearses all 4 quarterly rotation steps and appends dated audit entries", async () => {
    let tick = 10_000;
    const report = await runQuarterlyRotationDrill({
      dryRun: true,
      now: () => {
        tick += 500;
        return tick;
      },
      isoNow: () => "2026-11-23T00:00:00.000Z",
    });

    expect(report.cadence).toBe("quarterly");
    expect(report.steps.map((s) => s.step)).toEqual([
      "agent-wallet",
      "oz-api-key",
      "llm-api-key",
      "mpp-secret",
    ]);
    expect(report.steps[0].mode).toBe("dry-run");
    expect(report.recommendedCalendarMinutes).toBeGreaterThanOrEqual(30);

    const lines = readFileSync(process.env.AUDIT_LOG_FILE!, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { event: string; details?: { secret?: string; rotatedAt?: string } });

    expect(lines).toHaveLength(4);
    expect(lines.every((entry) => entry.event === "secret.rotated")).toBe(true);
    expect(lines.map((entry) => entry.details?.secret)).toEqual([
      "agent-wallet",
      "oz-api-key",
      "llm-api-key",
      "mpp-secret",
    ]);
    expect(lines.every((entry) => entry.details?.rotatedAt === "2026-11-23T00:00:00.000Z")).toBe(true);
  });
});
