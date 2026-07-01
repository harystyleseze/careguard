import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

function b64enc(data: string): string {
  if (typeof globalThis.btoa === "function") {
    const bytes = new TextEncoder().encode(data);
    const binary = String.fromCharCode(...bytes);
    return globalThis.btoa(binary);
  }
  return Buffer.from(data, "utf8").toString("base64");
}

function b64dec(data: string): string {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(data);
    return new TextDecoder().decode(new Uint8Array([...binary].map(c => c.charCodeAt(0))));
  }
  return Buffer.from(data, "base64").toString("utf8");
}

const mockVerify = vi.fn<(...args: unknown[]) => Promise<{ isValid: boolean; invalidReason?: string }>>();
const mockSettle = vi.fn<(...args: unknown[]) => Promise<{ success: boolean; transaction?: string; network?: string; errorReason?: string; errorMessage?: string }>>();

vi.mock("@x402/core/server", () => ({
  HTTPFacilitatorClient: vi.fn().mockImplementation(() => ({
    getSupported: vi.fn().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
      extensions: [],
      signers: {},
    }),
    verify: mockVerify,
    settle: mockSettle,
    createAuthHeaders: vi.fn().mockResolvedValue({}),
  })),
  FacilitatorResponseError: class extends Error {
    constructor(m: string) { super(m); this.name = "FacilitatorResponseError"; }
  },
}));

vi.mock("@x402/stellar/exact/server", () => ({
  ExactStellarScheme: vi.fn().mockImplementation(() => ({
    scheme: "exact",
    parsePrice: vi.fn().mockResolvedValue({ amount: "100000", asset: "USDC" }),
    enhancePaymentRequirements: vi.fn().mockImplementation((r: unknown) => Promise.resolve(r)),
    getAssetDecimals: vi.fn().mockReturnValue(7),
  })),
}));

import { applyX402Middleware } from "../x402-middleware.ts";

const protectedRoutes = {
  "GET /api/protected": {
    accepts: { scheme: "exact", network: "stellar:testnet", payTo: "GDPLJ4FHGQ5LMD7Y5G6R3F6V3K7Q5W6R3F6V3K7Q5W6R3F6V3K7Q5W6", price: "$0.10" },
    description: "Protected test endpoint",
  },
};

function createApp() {
  const app = express();
  app.use(express.json());
  applyX402Middleware(app, protectedRoutes, {
    apiKey: "test-api-key",
    facilitatorUrl: "https://test-facilitator.example.com",
    network: "stellar:testnet",
    healthCheckIntervalMs: 5000,
  });
  app.get("/api/protected", (_req, res) => {
    res.json({ ok: true, data: "protected content" });
  });
  return app;
}

const validPaymentPayload = {
  x402Version: 2,
  accepted: {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "100000",
    asset: "USDC",
    payTo: "GDPLJ4FHGQ5LMD7Y5G6R3F6V3K7Q5W6R3F6V3K7Q5W6R3F6V3K7Q5W6",
    maxTimeoutSeconds: 300,
    extra: {},
  },
  payload: { signature: "test-sig" },
};

describe("x402 middleware integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 402 with payment requirements for unpaid request", async () => {
    const app = createApp();
    const res = await supertest(app).get("/api/protected");

    expect(res.status).toBe(402);
    expect(res.body).toEqual({});
    expect(res.headers).toHaveProperty("payment-required");
    const paymentReqHeader = res.headers["payment-required"] as string;
    const paymentReq = JSON.parse(b64dec(paymentReqHeader));
    expect(paymentReq).toHaveProperty("x402Version");
    expect(paymentReq).toHaveProperty("accepts");
    expect(paymentReq.accepts).toBeInstanceOf(Array);
    expect(paymentReq.accepts.length).toBeGreaterThan(0);
    expect(paymentReq.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "stellar:testnet",
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("returns 200 for valid paid request after verify and settle", async () => {
    mockVerify.mockResolvedValue({ isValid: true });
    mockSettle.mockResolvedValue({ success: true, transaction: "stellar:tx-hash-123", network: "stellar:testnet" });

    const app = createApp();
    const paymentHeader = b64enc(JSON.stringify(validPaymentPayload));
    const res = await supertest(app)
      .get("/api/protected")
      .set("payment-signature", paymentHeader);

    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid payment and does not settle", async () => {
    mockVerify.mockResolvedValue({ isValid: false, invalidReason: "Invalid signature" });
    mockSettle.mockResolvedValue({ success: false, errorReason: "should-not-call" });

    const app = createApp();
    const paymentHeader = b64enc(JSON.stringify(validPaymentPayload));
    const res = await supertest(app)
      .get("/api/protected")
      .set("payment-signature", paymentHeader);

    expect(res.status).toBe(402);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("treats invalid base64 payment-signature header as unpaid", async () => {
    const app = createApp();
    const res = await supertest(app)
      .get("/api/protected")
      .set("payment-signature", "not-valid-base64!!!");
    expect(res.status).toBe(402);
    expect(res.headers).toHaveProperty("payment-required");
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it("does not interfere with unprotected routes", async () => {
    const app = createApp();
    app.get("/api/public", (_req, res) => {
      res.json({ ok: true });
    });
    const res = await supertest(app).get("/api/public");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
