import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.PHARMACY_1_PUBLIC_KEY = "GPUB123TESTPHARMAKEY";
process.env.MPP_SECRET_KEY = "SBTEST123SECRETKEY456789012345678901234567890123456789012345";
process.env.DATA_DIR = "./.tmp-pharmacy-payment-rate-limit-test";
process.env.RATE_LIMIT_PHARMACY_ORDER = "1";
process.env.NODE_ENV = "development";

const mockCharge = vi.fn(() => async () => ({
  status: 402,
  challenge: {
    headers: new Map([["X-Payment-Required", "1"]]),
    text: async () => JSON.stringify({ challenge: "pay-me" }),
  },
}));

vi.mock("mppx/server", () => ({
  Mppx: { create: vi.fn(() => ({ charge: mockCharge })) },
  Store: {
    fileSystem: vi.fn(() => ({ type: "file-system" })),
    memory: vi.fn(() => ({ type: "memory" })),
  },
}));

vi.mock("@stellar/mpp/charge/server", () => ({
  stellar: {
    charge: vi.fn(() => ({ type: "stellar-charge" })),
  },
}));

vi.mock("@stellar/mpp", () => ({
  USDC_SAC_TESTNET: "USDC_TESTNET_ADDR",
}));

vi.mock("../../shared/logger.ts", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../shared/cors.ts", () => ({
  createCorsMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../shared/security-middleware.ts", () => ({
  applySecurityMiddleware: vi.fn(),
}));

vi.mock("../../shared/request-lifecycle.ts", () => ({
  requestLifecycleMiddleware: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

vi.mock("../../shared/graceful-shutdown.ts", () => ({
  gracefulShutdown: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));

vi.resetModules();
const { app, server } = await import("../server.ts");

describe("standalone pharmacy payment rate limiting", () => {
  it("returns 429 with Retry-After when the pharmacy order policy is exceeded", async () => {
    const first = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 10 });

    const second = await request(app)
      .post("/pharmacy/order")
      .send({ drug: "Metformin", pharmacy: "CVS", amount: 10 });

    expect(first.status).toBe(402);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("60");
  });
});

afterAll(() => {
  server.close();
});
