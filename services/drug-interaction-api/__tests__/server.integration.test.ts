import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { Server } from "http";

/**
 * HTTP integration tests (Issue #789) for GET /drug/interactions and GET /ready.
 *
 * The x402 payment middleware itself (facilitator sync, verify/settle) has its own
 * dedicated contract tests (shared/__tests__/x402-*-contract.test.ts); here we mock
 * it as a no-op so we can drive the actual route handler — query parsing,
 * normalization, caps, and error shape — over real HTTP via supertest.
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
  process.env.PHARMACY_2_PUBLIC_KEY = "GPUB123TEST";
  process.env.DRUG_INTERACTION_API_PORT = "0"; // OS-assigned ephemeral port, avoids conflicts
  const mod = await import("../server.ts");
  app = mod.app;
  server = mod.server;
});

afterAll(() => {
  server?.close();
});

describe("GET /drug/interactions (Issue #789)", () => {
  it("returns interaction pairs with severity for a known pair", async () => {
    const res = await request(app).get("/drug/interactions?meds=Lisinopril,Potassium");
    expect(res.status).toBe(200);
    expect(res.body.interactionCount).toBe(1);
    expect(res.body.interactions[0]).toMatchObject({
      drug1: "Lisinopril",
      drug2: "Potassium",
      severity: "severe",
    });
    expect(res.body.overallRisk).toBe("high");
  });

  it("resolves case-mismatched and whitespace-padded names to the same interaction", async () => {
    const res = await request(app).get(
      "/drug/interactions?meds=" + encodeURIComponent("  LISINOPRIL , potassium  "),
    );
    expect(res.status).toBe(200);
    expect(res.body.interactionCount).toBe(1);
    expect(res.body.interactions[0].severity).toBe("severe");
    // Output uses canonical (title-case) naming regardless of input casing
    expect(res.body.interactions[0].drug1).toBe("Lisinopril");
    expect(res.body.interactions[0].drug2).toBe("Potassium");
  });

  it("a single-drug query returns an empty interactions array, not an error", async () => {
    const res = await request(app).get("/drug/interactions?meds=Lisinopril");
    expect(res.status).toBe(200);
    expect(res.body.interactionCount).toBe(0);
    expect(res.body.interactions).toEqual([]);
    expect(res.body.overallRisk).toBe("none");
  });

  it("rejects a missing meds param with a structured 4xx", async () => {
    const res = await request(app).get("/drug/interactions");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects an oversized drug list (>20 items) with a structured 4xx", async () => {
    const meds = Array.from({ length: 25 }, (_, i) => `drug${i}`).join(",");
    const res = await request(app).get(`/drug/interactions?meds=${meds}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.body.error).toMatch(/at most 20/);
  });

  it("does not leak stack traces or internal error text in the error response", async () => {
    const res = await request(app).get("/drug/interactions?meds=" + "x".repeat(5000));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/); // no stack-trace-shaped text
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("node_modules");
  });

  it("returns a JSON 400 for malformed JSON bodies", async () => {
    const res = await request(app)
      .post("/drug/interactions")
      .set("Content-Type", "application/json")
      .send("{bad json");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error).toBe("Invalid JSON body");
  });
});

describe("GET /ready (Issue #789)", () => {
  it("returns 200 when not draining", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
  });
});
