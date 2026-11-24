import { describe, it, expect, vi, beforeEach } from "vitest";
import { registry } from "../../../shared/metrics.ts";

// Mutable config-file contents returned by the mocked fs, reassigned per test.
let thresholdsJson: string | null = null;
let allowlistJson: string | null = null;

vi.hoisted(() => {
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER = "1.5";
  process.env.BILL_AUDIT_SUGGESTED_MULTIPLIER = "1.2";
  process.env.BILL_AUDIT_UPCODED_MULTIPLIER = "3.0";
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (path: any, enc?: any) => {
      const p = String(path);
      if (p.includes("audit_thresholds.json")) {
        return thresholdsJson === null ? actual.readFileSync(p, enc) : thresholdsJson;
      }
      if (p.includes("duplicates-allowlist.json")) {
        return allowlistJson === null ? actual.readFileSync(p, enc) : allowlistJson;
      }
      return actual.readFileSync(p, enc);
    },
  };
});

beforeEach(() => {
  thresholdsJson = null;
  allowlistJson = null;
});

import {
  loadAuditThresholds,
  loadDuplicateAllowlist,
  getAuditThreshold,
  isValidByCptMultiplier,
} from "../server.ts";

const VALID_THRESHOLDS = JSON.stringify({
  default: 1.5,
  byCpt: { "97110": 2.0, "99213": 1.5 },
});

const INVALID_BYCPT_THRESHOLDS = JSON.stringify({
  default: 1.5,
  byCpt: { "97110": 0.5 },
});

const EMPTY_ALLOWLIST = JSON.stringify([]);

function counterValue(name: string, labels: Record<string, string>): number {
  const m = registry.getSingleMetric(name);
  if (!m) return 0;
  const entry = (m.values ?? []).find((v: any) =>
    Object.entries(labels).every(([k, vv]) => v.labels[k] === vv),
  );
  return entry?.value ?? 0;
}

describe("loadAuditThresholds byCpt re-validation (Issue #919)", () => {
  it("enforces isValidByCptMultiplier bounds", () => {
    expect(isValidByCptMultiplier(0.5)).toBe(false);
    expect(isValidByCptMultiplier(1.0)).toBe(false);
    expect(isValidByCptMultiplier(3.1)).toBe(false);
    expect(isValidByCptMultiplier("2.0")).toBe(false);
    expect(isValidByCptMultiplier(2.0)).toBe(true);
    expect(isValidByCptMultiplier(3.0)).toBe(true);
  });

  it("loads valid byCpt overrides at boot", () => {
    thresholdsJson = VALID_THRESHOLDS;
    loadAuditThresholds();
    expect(getAuditThreshold("97110")).toBe(2.0);
    expect(getAuditThreshold("99213")).toBe(1.5);
  });

  it("rejects an invalid byCpt override via simulated reload and retains previous thresholds", () => {
    thresholdsJson = VALID_THRESHOLDS;
    loadAuditThresholds();
    expect(getAuditThreshold("97110")).toBe(2.0);

    const before = counterValue("bill_audit_config_load_failure_total", { config: "thresholds" });

    thresholdsJson = INVALID_BYCPT_THRESHOLDS;
    loadAuditThresholds();

    // Previous valid thresholds retained (invalid 0.5 not applied).
    expect(getAuditThreshold("97110")).toBe(2.0);
    // Reload failure reflected in the metric.
    expect(counterValue("bill_audit_config_load_failure_total", { config: "thresholds" })).toBe(before + 1);
  });
});

describe("config reload failure metric (Issue #921)", () => {
  it("increments the failure metric when allowlist reload fails", () => {
    allowlistJson = "not valid json{{";
    const before = counterValue("bill_audit_config_load_failure_total", { config: "allowlist" });

    loadDuplicateAllowlist();

    expect(counterValue("bill_audit_config_load_failure_total", { config: "allowlist" })).toBe(before + 1);
  });

  it("loads an empty allowlist successfully", () => {
    allowlistJson = EMPTY_ALLOWLIST;
    expect(() => loadDuplicateAllowlist()).not.toThrow();
  });
});
