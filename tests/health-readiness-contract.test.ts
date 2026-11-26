/**
 * Contract test: GET /health and GET /ready response schema (Issue #986).
 *
 * docs/observability/health-checks.md pins the exact JSON shapes consumed by
 * Render (/health), Docker Compose and manual operator checks (/ready).
 * This test drives the live server.ts routes over HTTP so a shape drift in
 * the implementation fails here instead of breaking an external consumer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

vi.spyOn(Keypair, "fromSecret").mockImplementation(
  () => ({ publicKey: () => "GBQTESTHEALTHCONTRACT" }) as any,
);

vi.mock("../shared/x402-middleware.ts", () => ({
  applyX402Middleware: vi.fn(),
  NETWORK: "stellar:testnet",
  OZ_FACILITATOR_URL: "https://example.test/x402",
}));

process.env.LLM_API_KEY = "health-contract-llm-key";
process.env.AGENT_SECRET_KEY = "S-health-contract-key";
process.env.MPP_SECRET_KEY = "health-contract-mpp-key";
process.env.CAREGIVER_TOKEN = "health-contract-token";
process.env.PHARMACY_1_PUBLIC_KEY = "GBQTESTPHARMACY1";
process.env.BILL_PROVIDER_PUBLIC_KEY = "GBQTESTBILLPROVIDER";
// Set before importing server.ts: the env schema is parsed at module load.
process.env.OZ_FACILITATOR_API_KEY = "health-contract-facilitator-key";

const { app, setDegradedMode, setOzFacilitatorReachable } = await import("../server.ts");

describe("health/readiness response schema — contract (Issue #986)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setDegradedMode(false);
    setOzFacilitatorReachable(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
  });

  afterEach(() => {
    setDegradedMode(false);
    setOzFacilitatorReachable(false);
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("GET /health always returns HTTP 200 with exactly { status: 'ok' }", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(Object.keys(res.body)).toEqual(["status"]);
  });

  it("GET /health keeps the liveness shape even while boot-degraded", async () => {
    // Liveness is deliberately independent of dependency state per the doc —
    // degraded is a readiness concern, never a liveness body change.
    setDegradedMode(true);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /ready returns the documented healthy schema", async () => {
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: {
        env: true,
        horizon: true,
        ozFacilitator: true,
      },
    });
  });

  it("GET /ready uses true|string check values and 503 when a dependency fails", async () => {
    // Horizon failure -> boolean false; facilitator not yet verified -> string.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    setOzFacilitatorReachable(false);

    const res = await request(app).get("/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(Object.keys(res.body.checks).sort()).toEqual([
      "env",
      "horizon",
      "ozFacilitator",
    ]);
    expect(res.body.checks.env).toBe(true);
    expect(res.body.checks.horizon).toBe(false);
    expect(res.body.checks.ozFacilitator).toBe("not yet verified");

    for (const value of Object.values(res.body.checks)) {
      expect(typeof value === "boolean" || typeof value === "string").toBe(true);
    }
  });

  it("GET /ready reports missing env as a descriptive string and stays degraded", async () => {
    const saved = process.env.LLM_API_KEY;
    delete process.env.LLM_API_KEY;
    try {
      const res = await request(app).get("/ready");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("degraded");
      expect(res.body.checks.env).toBe("missing: LLM_API_KEY");
      expect(typeof res.body.checks.env).toBe("string");
    } finally {
      process.env.LLM_API_KEY = saved;
    }
  });
});
