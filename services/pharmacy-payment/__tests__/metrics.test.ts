import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

let mppChargeHandler: ((webReq: Request) => Promise<any>) | null = null;

const mockMppxCreate = vi.fn(() => ({
  charge: vi.fn((_opts: any) => (webReq: Request) => {
    if (mppChargeHandler) return mppChargeHandler(webReq);
    return Promise.resolve({
      status: 402,
      challenge: {
        headers: new Map([["X-Payment-Required", "1"]]),
        text: async () => JSON.stringify({ challenge: "pay-me" }),
      },
    });
  }),
}));

vi.mock("mppx/server", () => ({
  Mppx: { create: mockMppxCreate },
  Store: {
    fileSystem: vi.fn((p: string) => ({ type: "fileSystem", path: p })),
    memory: vi.fn(() => ({ type: "memory" })),
  },
}));

vi.mock("@stellar/mpp/charge/server", () => ({
  stellar: {
    charge: vi.fn((opts: any) => ({ type: "stellar-charge", ...opts })),
  },
}));

vi.mock("@stellar/mpp", () => ({
  USDC_SAC_TESTNET: "USDC_TESTNET_ADDR",
}));

vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("dotenv/config", () => ({}));

process.env.PHARMACY_1_PUBLIC_KEY = "GPUB123TESTPHARMAKEY";
process.env.MPP_SECRET_KEY = "SBTEST123SECRETKEY456789012345678901234567890123456789012345";

// Import app after env vars and mocks are configured
const { app } = await import("../server.ts");

describe("Pharmacy Payment Service — /metrics endpoint & instrumentation (Issue #1015)", () => {
  const originalToken = process.env.METRICS_TOKEN;

  beforeEach(() => {
    mppChargeHandler = null;
    delete process.env.METRICS_TOKEN;
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.METRICS_TOKEN = originalToken;
    } else {
      delete process.env.METRICS_TOKEN;
    }
  });

  it("exposes GET /metrics returning Prometheus text format", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toContain("# HELP");
    expect(res.text).toContain("# TYPE");
  });

  it("includes pharmacy payment counters in the scrape output", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/pharmacy_payment_orders_total/);
    expect(res.text).toMatch(/pharmacy_mpp_charges_total/);
  });

  it("gates GET /metrics behind METRICS_TOKEN when configured", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token-123";

    // Unauthenticated request should be rejected with 401
    const unauthRes = await request(app).get("/metrics");
    expect(unauthRes.status).toBe(401);

    // Invalid token should also be rejected
    const badTokenRes = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer invalid-token");
    expect(badTokenRes.status).toBe(401);

    // Valid Bearer token should succeed with 200
    const validRes = await request(app)
      .get("/metrics")
      .set("Authorization", "Bearer secret-metrics-token-123");
    expect(validRes.status).toBe(200);
    expect(validRes.text).toContain("# HELP");
  });

  it("increments order metrics on invalid order request", async () => {
    // Send an invalid request (missing drug and amount)
    await request(app)
      .post("/pharmacy/order")
      .send({ pharmacy: "CVS" });

    const metricsRes = await request(app).get("/metrics");
    expect(metricsRes.text).toContain('pharmacy_payment_orders_total{status="invalid_request",pharmacy="unknown"}');
  });

  it("increments MPP charge challenge metric on 402 payment challenge", async () => {
    // Send valid payload without payment credentials -> triggers 402 challenge
    const res = await request(app)
      .post("/pharmacy/order")
      .send({
        drug: "Lisinopril",
        pharmacy: "HealthFirst",
        amount: "14.50",
      });

    expect(res.status).toBe(402);

    const metricsRes = await request(app).get("/metrics");
    expect(metricsRes.text).toMatch(/pharmacy_mpp_charges_total.*status="challenge"/);
  });
});
