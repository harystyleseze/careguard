/**
 * Game-Day Drill #962: OZ facilitator outage fail-closed invariants.
 *
 * Verifies:
 * 1. `createX402HealthGate` blocks protected routes with HTTP 503 when `x402FacilitatorState.healthy` is false.
 * 2. `checkFacilitatorHealth` flips `x402FacilitatorState.healthy` to false on egress/network error,
 *    and restores it to true when the facilitator responds again.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

const { mockGetSupported } = vi.hoisted(() => ({
  mockGetSupported: vi.fn(),
}));

vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: vi.fn().mockImplementation(() => ({
    getSupported: mockGetSupported,
  })),
}));

vi.mock("@x402/express", () => ({
  paymentMiddlewareFromConfig: vi.fn(),
}));

vi.mock("@x402/stellar/exact/server", () => ({
  ExactStellarScheme: vi.fn(),
}));

import {
  x402FacilitatorState,
  checkFacilitatorHealth,
  createX402HealthGate,
} from "../../shared/x402-middleware.ts";

describe("Drill #962: OZ facilitator outage fail-closed behaviour", () => {
  beforeEach(() => {
    x402FacilitatorState.healthy = true;
    x402FacilitatorState.lastError = undefined;
    mockGetSupported.mockReset();
  });

  it("flips unhealthy on facilitator egress failure and returns 503 on protected routes", async () => {
    const app = express();
    app.use(createX402HealthGate([{ method: "GET", path: "/pharmacy/compare" }]));
    app.get("/pharmacy/compare", (_req, res) => res.json({ ok: true }));
    app.get("/health", (_req, res) => res.json({ status: "ok" }));

    // Simulate egress block to facilitator
    mockGetSupported.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const healthy = await checkFacilitatorHealth({ getSupported: mockGetSupported } as never);
    expect(healthy).toBe(false);
    expect(x402FacilitatorState.healthy).toBe(false);

    // Paid route fails closed (503) without executing handler
    const paidRes = await supertest(app).get("/pharmacy/compare");
    expect(paidRes.status).toBe(503);
    expect(paidRes.body.error).toMatch(/facilitator unavailable/i);

    // Free liveness route remains available
    const healthRes = await supertest(app).get("/health");
    expect(healthRes.status).toBe(200);

    // Simulate egress restoration
    mockGetSupported.mockResolvedValueOnce({ kinds: [] });
    const recovered = await checkFacilitatorHealth({ getSupported: mockGetSupported } as never);
    expect(recovered).toBe(true);
    expect(x402FacilitatorState.healthy).toBe(true);

    const recoveredRes = await supertest(app).get("/pharmacy/compare");
    expect(recoveredRes.status).toBe(200);
  });
});
