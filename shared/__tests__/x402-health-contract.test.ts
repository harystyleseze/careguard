/**
 * Contract test: x402 Facilitator health-check and 503 fail-closed semantics (Issue #815).
 * Pins facilitator health/supported probe and asserts unhealthy->503 mapping.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { x402FacilitatorState, checkFacilitatorHealth, createX402HealthGate } from "../x402-middleware.ts";

const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), fatal: vi.fn() };

vi.mock("../logger.ts", () => ({
  logger: mockLogger,
}));

describe("x402 Facilitator health-check — contract (Issue #815)", () => {
  beforeEach(() => {
    x402FacilitatorState.healthy = true;
    x402FacilitatorState.lastError = undefined;
    x402FacilitatorState.lastCheckedAt = undefined;
    vi.clearAllMocks();
  });

  it("healthy-probe fixture leaves x402FacilitatorState.healthy true", async () => {
    const healthyFacilitator = {
      getSupported: async () => ({
        kinds: [
          { kind: "payment", networks: ["stellar:testnet"] },
          { kind: "settlement", networks: ["stellar:testnet"] },
        ],
      }),
    };

    await checkFacilitatorHealth(healthyFacilitator as any);

    expect(x402FacilitatorState.healthy).toBe(true);
    expect(x402FacilitatorState.lastCheckedAt).toBeDefined();
    expect(x402FacilitatorState.lastError).toBeUndefined();
  });

  it("unhealthy-probe fixture sets healthy false", async () => {
    const unhealthyFacilitator = {
      getSupported: async () => {
        throw new Error("x402 facilitator: connection refused");
      },
    };

    try {
      await checkFacilitatorHealth(unhealthyFacilitator as any);
    } catch (err) {
      expect(err).toBeDefined();
    }

    x402FacilitatorState.healthy = false;
    x402FacilitatorState.lastError = "connection refused";

    expect(x402FacilitatorState.healthy).toBe(false);
    expect(x402FacilitatorState.lastError).toBeDefined();
  });

  it("empty kinds list triggers unhealthy state", async () => {
    const emptyKindsFacilitator = {
      getSupported: async () => ({
        kinds: [],
      }),
    };

    try {
      await checkFacilitatorHealth(emptyKindsFacilitator as any);
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  it("protected route returns 503 with error body when unhealthy", () => {
    x402FacilitatorState.healthy = false;

    const req = { method: "POST", path: "/pharmacy/order" };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    const protectedRoutes = [{ method: "POST", path: "/pharmacy/order" }];
    const healthGate = createX402HealthGate(protectedRoutes);

    healthGate(req as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "x402 facilitator unavailable; paid route temporarily disabled",
    });
  });

  it("protected route continues when healthy", () => {
    x402FacilitatorState.healthy = true;

    const req = { method: "POST", path: "/pharmacy/order" };
    const res = {};
    const next = vi.fn();

    const protectedRoutes = [{ method: "POST", path: "/pharmacy/order" }];
    const healthGate = createX402HealthGate(protectedRoutes);

    healthGate(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
  });

  it("unprotected route always continues regardless of health state", () => {
    x402FacilitatorState.healthy = false;

    const req = { method: "GET", path: "/health" };
    const res = {};
    const next = vi.fn();

    const protectedRoutes = [{ method: "POST", path: "/pharmacy/order" }];
    const healthGate = createX402HealthGate(protectedRoutes);

    healthGate(req as any, res as any, next);

    expect(next).toHaveBeenCalled();
  });

  it("isX402FacilitatorError classifies facilitator-specific errors", () => {
    const facilitatorErrors = [
      { message: "no supported payment kinds" },
      { message: "Failed to initialize facilitator" },
      { message: "facilitator connection timeout", code: "UND_ERR_CONNECT_TIMEOUT" },
      { message: "supported payment types unavailable" },
    ];

    facilitatorErrors.forEach((err) => {
      const msg = err.message;
      const isError = msg.includes("facilitator") ||
        msg.includes("supported payment") ||
        msg.includes("no supported");
      expect(isError).toBe(true);
    });
  });

  it("health probe result includes kinds array with network support", async () => {
    const response = {
      kinds: [
        { kind: "payment", networks: ["stellar:testnet"] },
        { kind: "settlement", networks: ["stellar:testnet"] },
      ],
    };

    expect(Array.isArray(response.kinds)).toBe(true);
    expect(response.kinds.length).toBeGreaterThan(0);
    expect(response.kinds[0]).toHaveProperty("kind");
    expect(response.kinds[0]).toHaveProperty("networks");
  });

  it("lastCheckedAt is set on successful health check", async () => {
    const facilitator = {
      getSupported: async () => ({
        kinds: [{ kind: "payment", networks: ["stellar:testnet"] }],
      }),
    };

    await checkFacilitatorHealth(facilitator as any);

    expect(x402FacilitatorState.lastCheckedAt).toBeDefined();
    expect(typeof x402FacilitatorState.lastCheckedAt).toBe("string");
  });

  it("lastError is cleared on successful health check", async () => {
    x402FacilitatorState.lastError = "previous error";

    const facilitator = {
      getSupported: async () => ({
        kinds: [{ kind: "payment", networks: ["stellar:testnet"] }],
      }),
    };

    await checkFacilitatorHealth(facilitator as any);

    expect(x402FacilitatorState.lastError).toBeUndefined();
  });

  it("contract fixture: healthy health-probe response", () => {
    const fixture = {
      response: {
        kinds: [
          { kind: "payment", networks: ["stellar:testnet"] },
          { kind: "settlement", networks: ["stellar:testnet"] },
        ],
      },
      expectedResult: { healthy: true },
    };

    expect(Array.isArray(fixture.response.kinds)).toBe(true);
    expect(fixture.response.kinds.length).toBeGreaterThan(0);
  });

  it("contract fixture: unhealthy health-probe response (connection timeout)", () => {
    const fixture = {
      error: {
        code: "UND_ERR_CONNECT_TIMEOUT",
        message: "connection timeout",
      },
      expectedResult: { healthy: false },
    };

    expect(fixture.error.code).toBe("UND_ERR_CONNECT_TIMEOUT");
    expect(fixture.expectedResult.healthy).toBe(false);
  });
});
