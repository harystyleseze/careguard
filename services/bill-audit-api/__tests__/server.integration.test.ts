import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "http";

/**
 * HTTP integration tests (Issue #788) for POST /bill/audit, GET /bill/sample,
 * and GET /ready, against the real server.ts app (exported for testing).
 *
 * The x402 payment middleware is mocked out — it has its own dedicated
 * contract tests (shared/__tests__/x402-*-contract.test.ts) — everything else
 * (request parsing, audit_thresholds.json / duplicates-allowlist.json
 * loading, auditBill()) runs unmocked against the real files on disk.
 */

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

let app: Express;
let server: Server;

beforeAll(async () => {
  process.env.BILL_PROVIDER_PUBLIC_KEY = "GPUB123TEST";
  process.env.BILL_AUDIT_API_PORT = "0";
  const mod = await import("../server.ts");
  app = mod.app;
  server = mod.server;
});

afterAll(() => {
  server?.close();
});

describe("POST /bill/audit (Issue #788)", () => {
  it("finds overcharge/duplicate findings matching audit_thresholds.json multipliers", async () => {
    const res = await request(app)
      .post("/bill/audit")
      .send({
        lineItems: [
          // fairRate 45, threshold 1.5x = 67.5 -> charged 180 is well over -> overcharged/upcoded
          { description: "Chest X-ray, 2 views", cptCode: "71046", quantity: 1, chargedAmount: 180 },
          // Duplicate CPT code, not on the allowlist
          { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
          { description: "Complete blood count (CBC)", cptCode: "85025", quantity: 1, chargedAmount: 45 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.errorCount).toBeGreaterThanOrEqual(2);
    const statuses = res.body.lineItems.map((li: any) => li.status);
    expect(statuses).toContain("duplicate");
    expect(statuses.some((s: string) => s === "overcharged" || s === "upcoded")).toBe(true);
  });

  it("rejects an empty lineItems array with a structured 4xx, not a 500", async () => {
    const res = await request(app).post("/bill/audit").send({ lineItems: [] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeDefined();
    expect(typeof res.body.code).toBe("string");
  });

  it("rejects a negative chargedAmount with a structured 4xx", async () => {
    const res = await request(app)
      .post("/bill/audit")
      .send({ lineItems: [{ description: "Visit", cptCode: "99213", quantity: 1, chargedAmount: -50 }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.code).toBeDefined();
  });

  it("rejects a NaN chargedAmount with a structured 4xx", async () => {
    const res = await request(app)
      .post("/bill/audit")
      .send({ lineItems: [{ description: "Visit", cptCode: "99213", quantity: 1, chargedAmount: NaN }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.code).toBeDefined();
  });

  it("rejects a malformed CPT code with a structured 4xx", async () => {
    const res = await request(app)
      .post("/bill/audit")
      .send({ lineItems: [{ description: "Visit", cptCode: "not-a-cpt", quantity: 1, chargedAmount: 50 }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.code).toBeDefined();
  });

  it("rejects an oversized lineItems array before processing it", async () => {
    const lineItems = Array.from({ length: 501 }, () => ({
      description: "Visit",
      cptCode: "99213",
      quantity: 1,
      chargedAmount: 50,
    }));
    const res = await request(app).post("/bill/audit").send({ lineItems });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds max/);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a payload that exceeds the body size limit with a 413 and standardized shape", async () => {
    const hugeBody = {
      lineItems: Array.from({ length: 3000 }, () => ({
        description: "A".repeat(100),
        cptCode: "99213",
        quantity: 1,
        chargedAmount: 50,
      }))
    };
    const res = await request(app).post("/bill/audit").send(hugeBody);
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Request body too large");
    expect(res.body.code).toBe("BODY_TOO_LARGE");
    expect(res.body.details).toBeDefined();
    expect(res.body.details.limit).toBeDefined();
  });
});

describe("GET /bill/sample (Issue #788)", () => {
  it("returns a valid sample bill", async () => {
    const res = await request(app).get("/bill/sample");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.lineItems)).toBe(true);
    expect(res.body.lineItems.length).toBeGreaterThan(0);
    for (const item of res.body.lineItems) {
      expect(typeof item.cptCode).toBe("string");
      expect(typeof item.chargedAmount).toBe("number");
    }
  });
});

describe("GET /ready (Issue #788)", () => {
  it("returns 200 when thresholds and allowlist files loaded", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
  });
});
