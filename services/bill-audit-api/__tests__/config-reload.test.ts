import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

const thresholdReads: any[] = [];

vi.mock("dotenv/config", () => ({}));
vi.mock("../../../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.invalid/facilitator",
}));
vi.mock("../../../shared/x402-verify-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.invalid/facilitator",
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: (filePath: any, options: any) => {
      if (typeof filePath === "string" && filePath.includes("audit_thresholds.json")) {
        if (thresholdReads.length > 0) return thresholdReads.shift();
      }
      return actual.readFileSync(filePath, options);
    },
  };
});

describe("bill-audit config reload", () => {
  beforeEach(() => {
    vi.resetModules();
    thresholdReads.length = 0;
    process.env.BILL_PROVIDER_PUBLIC_KEY = "GPUB123TEST";
    process.env.BILL_AUDIT_API_PORT = "0";
    delete process.env.BILL_AUDIT_OVERCHARGE_MULTIPLIER;
  });

  afterEach(() => {
    delete process.env.BILL_PROVIDER_PUBLIC_KEY;
    delete process.env.BILL_AUDIT_API_PORT;
  });

  it("rejects invalid byCpt override on SIGHUP and retains previous valid thresholds", async () => {
    const mod = await import("../server.ts");
    const app = mod.app;
    const server = mod.server;
    try {
      const before = mod.auditBill([
        { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 1, chargedAmount: 180 },
      ]);
      expect(["overcharged", "upcoded"]).toContain(before.lineItems[0].status);

      thresholdReads.push(JSON.stringify({ default: 1.5, byCpt: { "71046": 5.0 } }));
      process.emit("SIGHUP", "SIGHUP");

      const after = mod.auditBill([
        { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 1, chargedAmount: 180 },
      ]);
      expect(after.lineItems[0].status).toBe(before.lineItems[0].status);

      const metrics = await request(app).get("/metrics");
      expect(metrics.status).toBe(200);
      expect(metrics.text).toMatch(/bill_audit_config_reload_failures_total\{config="thresholds"\}\s+[1-9]/);
      expect(metrics.text).toMatch(/bill_audit_config_loaded\{config="thresholds"\}\s+1/);
    } finally {
      server.close();
      process.removeAllListeners("SIGHUP");
    }
  });

  it("exposes config loaded metrics on /metrics", async () => {
    const mod = await import("../server.ts");
    const app = mod.app;
    const server = mod.server;
    try {
      const res = await request(app).get("/metrics");
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/bill_audit_config_loaded\{config="thresholds"\}\s+1/);
      expect(res.text).toMatch(/bill_audit_config_loaded\{config="allowlist"\}\s+1/);
    } finally {
      server.close();
      process.removeAllListeners("SIGHUP");
    }
  });
});
