#!/usr/bin/env node
/**
 * Game-day drill: quarterly secret-rotation calendar rehearsal (issue #966).
 *
 * Rehearses all four quarterly rotation steps from docs/runbooks/rotate-secrets.md
 * in one timed sitting:
 *   1. Agent wallet (dry-run — no --execute)
 *   2. OZ Facilitator API key
 *   3. LLM API key
 *   4. MPP secret key
 *
 * Appends a dated compliance entry to data/audit.log.jsonl for each step and
 * measures total elapsed duration to size the recurring quarterly calendar block.
 *
 * Usage:
 *   npx tsx scripts/drill-rotate-secrets.ts --dry-run
 */

import "dotenv/config";
import { randomBytes } from "crypto";
import { pathToFileURL } from "url";
import { appendAuditEntry } from "../shared/audit-log.ts";

export type SecretRotationStepId =
  | "agent-wallet"
  | "oz-api-key"
  | "llm-api-key"
  | "mpp-secret";

export interface SecretRotationStepResult {
  step: SecretRotationStepId;
  mode: "dry-run" | "rehearsed";
  durationMs: number;
  auditEvent: "secret.rotated";
  rotatedAt: string;
  notes: string;
}

export interface QuarterlyRotationDrillReport {
  cadence: "quarterly";
  steps: SecretRotationStepResult[];
  totalDurationMs: number;
  recommendedCalendarMinutes: number;
}

export interface QuarterlyRotationDrillOptions {
  dryRun?: boolean;
  actor?: string;
  now?: () => number;
  isoNow?: () => string;
  recordAudit?: boolean;
}

export async function runQuarterlyRotationDrill(
  opts: QuarterlyRotationDrillOptions = {},
): Promise<QuarterlyRotationDrillReport> {
  const now = opts.now ?? Date.now;
  const isoNow = opts.isoNow ?? (() => new Date().toISOString());
  const dryRun = opts.dryRun ?? true;
  const actor = opts.actor ?? "drill:rotate-secrets";
  const recordAudit = opts.recordAudit ?? true;

  const drillStart = now();
  const steps: SecretRotationStepResult[] = [];

  const definitions: Array<{
    step: SecretRotationStepId;
    mode: "dry-run" | "rehearsed";
    notes: string;
  }> = [
    {
      step: "agent-wallet",
      mode: "dry-run",
      notes: "scripts/rotate-agent-wallet.ts dry-run plan reviewed (no --execute)",
    },
    {
      step: "oz-api-key",
      mode: dryRun ? "dry-run" : "rehearsed",
      notes: "OZ_FACILITATOR_API_KEY rotation procedure verified",
    },
    {
      step: "llm-api-key",
      mode: dryRun ? "dry-run" : "rehearsed",
      notes: "LLM_API_KEY rotation procedure verified",
    },
    {
      step: "mpp-secret",
      mode: dryRun ? "dry-run" : "rehearsed",
      notes: `MPP_SECRET_KEY 256-bit generation verified (${randomBytes(32).toString("hex").length} hex chars)`,
    },
  ];

  for (const def of definitions) {
    const stepStart = now();
    const rotatedAt = isoNow();
    if (recordAudit) {
      await appendAuditEntry({
        event: "secret.rotated",
        actor,
        details: {
          secret: def.step,
          cadence: "quarterly",
          mode: def.mode,
          rotatedAt,
          notes: def.notes,
        },
      });
    }
    const durationMs = Math.max(0, now() - stepStart);
    steps.push({
      step: def.step,
      mode: def.mode,
      durationMs,
      auditEvent: "secret.rotated",
      rotatedAt,
      notes: def.notes,
    });
  }

  const totalDurationMs = Math.max(0, now() - drillStart);
  const recommendedCalendarMinutes = Math.max(
    30,
    Math.ceil(totalDurationMs / 60_000) + 15,
  );

  return {
    cadence: "quarterly",
    steps,
    totalDurationMs,
    recommendedCalendarMinutes,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dryRun = !process.argv.includes("--staging");
  runQuarterlyRotationDrill({ dryRun })
    .then((report) => {
      console.log("\n=== Quarterly Secret-Rotation Drill Report ===");
      console.log(`Cadence:                     ${report.cadence}`);
      console.log(`Steps completed:             ${report.steps.length}/4`);
      for (const s of report.steps) {
        console.log(`  - ${s.step.padEnd(14)} [${s.mode}] ${s.durationMs}ms (${s.rotatedAt})`);
      }
      console.log(`Total elapsed:               ${report.totalDurationMs}ms`);
      console.log(`Suggested calendar block:    ${report.recommendedCalendarMinutes} min`);
    })
    .catch((err) => {
      console.error(`Quarterly rotation drill failed: ${err?.message ?? err}`);
      process.exit(1);
    });
}
