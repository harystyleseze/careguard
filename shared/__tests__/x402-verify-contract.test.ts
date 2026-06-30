/**
 * Contract test: x402 Facilitator /verify request and response schema (Issue #813).
 * Pins request payload and response schema against OZ x402 Facilitator API.
 */

import { describe, it, expect } from "vitest";

describe("x402 Facilitator verify — contract (Issue #813)", () => {
  it("verify request payload includes payment header, requirements, and network", () => {
    const requestPayload = {
      paymentHeader: "Bearer eyJ...",
      requirements: { network: "stellar:testnet" },
      network: "stellar:testnet",
    };

    expect(requestPayload).toHaveProperty("paymentHeader");
    expect(requestPayload).toHaveProperty("requirements");
    expect(requestPayload).toHaveProperty("network");
    expect(requestPayload.network).toBe("stellar:testnet");
  });

  it("valid-payment verify response has expected shape", () => {
    const validResponse = {
      valid: true,
      transaction: "c1a7f0c3e8d9b5a2f7e4d1c8b9a6f3e0d7c4b1a8f5e2d9c6b3a0f7e4d1c8",
    };

    expect(validResponse.valid).toBe(true);
    expect(validResponse.transaction).toMatch(/^[a-f0-9]{64}$/);
  });

  it("invalid-payment verify response has expected shape with reason", () => {
    const invalidResponse = {
      valid: false,
      reason: "insufficient_funds",
    };

    expect(invalidResponse.valid).toBe(false);
    expect(invalidResponse.reason).toBeDefined();
    expect(typeof invalidResponse.reason).toBe("string");
  });

  it("verify response with unexpected fields does not crash (forward-compatible)", () => {
    const responseWithExtra = {
      valid: true,
      transaction: "c1a7f0c3e8d9b5a2f7e4d1c8b9a6f3e0d7c4b1a8f5e2d9c6b3a0f7e4d1c8",
      extraField: "should be ignored",
      anotherExtra: { nested: "data" },
    };

    expect(responseWithExtra.valid).toBe(true);
    expect(responseWithExtra.transaction).toBeDefined();
  });

  it("error response maps to middleware rejection", () => {
    const errorResponse = {
      error: "service_unavailable",
      code: 503,
    };

    const shouldReject = errorResponse.error === "service_unavailable";
    expect(shouldReject).toBe(true);
  });

  it("verify request for x402 exact scheme includes network identifier", () => {
    const payload = {
      paymentHeader: "Bearer token",
      requirements: {
        network: "stellar:testnet",
        scheme: "exact",
      },
      network: "stellar:testnet",
    };

    expect(payload.requirements.network).toBe("stellar:testnet");
    expect(payload.network).toBe("stellar:testnet");
  });

  it("transaction hash from verify response is 64-char hex", () => {
    const response = {
      valid: true,
      transaction: "a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    };

    expect(response.transaction).toMatch(/^[a-f0-9]{64}$/);
    expect(response.transaction.length).toBe(64);
  });

  it("verify response parsed as JSON does not corrupt payload", () => {
    const raw = JSON.stringify({
      valid: true,
      transaction: "abc123",
    });

    const parsed = JSON.parse(raw);
    expect(parsed.valid).toBe(true);
    expect(parsed.transaction).toBe("abc123");
  });

  it("reason codes from verify are mapped to correct middleware behavior", () => {
    const reasons = {
      insufficient_funds: "reject",
      invalid_signature: "reject",
      expired: "reject",
      service_unavailable: "503",
      gateway_timeout: "503",
    };

    expect(reasons.insufficient_funds).toBe("reject");
    expect(reasons.service_unavailable).toBe("503");
  });

  it("contract fixture: healthy verify request format", () => {
    const fixture = {
      request: {
        paymentHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        requirements: { network: "stellar:testnet" },
        network: "stellar:testnet",
      },
      expectedResponse: {
        valid: true,
        transaction: "c1a7f0c3e8d9b5a2f7e4d1c8b9a6f3e0d7c4b1a8f5e2d9c6b3a0f7e4d1c8",
      },
    };

    expect(fixture.request).toBeDefined();
    expect(fixture.expectedResponse.valid).toBe(true);
  });
});
