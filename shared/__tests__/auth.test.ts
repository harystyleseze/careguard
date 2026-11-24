import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";
import {
  safeCompare,
  requireApiKey,
  parseCookies,
  extractCaregiverToken,
  requireCaregiverToken,
} from "../auth.ts";

describe("safeCompare", () => {
  it("should return true for identical strings", () => {
    expect(safeCompare("hello", "hello")).toBe(true);
    expect(safeCompare("", "")).toBe(true);
    expect(safeCompare("a".repeat(100), "a".repeat(100))).toBe(true);
  });

  it("should return false for different strings of the same length", () => {
    expect(safeCompare("hello", "world")).toBe(false);
    expect(safeCompare("a", "b")).toBe(false);
  });

  it("should return false for strings of different lengths without throwing", () => {
    expect(safeCompare("hello", "helloo")).toBe(false);
    expect(safeCompare("helloo", "hello")).toBe(false);
    expect(safeCompare("", "a")).toBe(false);
    expect(safeCompare("a", "a".repeat(1000))).toBe(false);
  });

  it("constant-length SHA-256 hash comparison executes in uniform time regardless of token length", () => {
    const target = "c".repeat(64);
    const shortToken = "c";
    const sameLengthDifferent = "d".repeat(64);
    const longToken = "c".repeat(1000);

    // Warm up JIT
    for (let i = 0; i < 1000; i++) {
      safeCompare(shortToken, target);
      safeCompare(sameLengthDifferent, target);
      safeCompare(longToken, target);
    }

    const t0 = performance.now();
    for (let i = 0; i < 5000; i++) safeCompare(shortToken, target);
    const dShort = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 5000; i++) safeCompare(sameLengthDifferent, target);
    const dSame = performance.now() - t1;

    // Timing difference between wrong lengths should be negligible (< 100ms for 5000 iterations)
    expect(Math.abs(dShort - dSame)).toBeLessThan(100);
  });
});

describe("parseCookies", () => {
  it("returns empty object for undefined or empty cookie header", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("   ")).toEqual({});
  });

  it("parses single cookie", () => {
    expect(parseCookies("caregiver_token=secret123")).toEqual({
      caregiver_token: "secret123",
    });
  });

  it("parses multiple cookies with whitespace", () => {
    const header = "caregiver_token=token1; csrf_token=csrf2; session_id=sess3";
    expect(parseCookies(header)).toEqual({
      caregiver_token: "token1",
      csrf_token: "csrf2",
      session_id: "sess3",
    });
  });

  it("preserves equals signs in cookie values", () => {
    const header = "payload=eyJhbGciOiJIUzI1NiJ9==; tag=v=1&foo=bar";
    expect(parseCookies(header)).toEqual({
      payload: "eyJhbGciOiJIUzI1NiJ9==",
      tag: "v=1&foo=bar",
    });
  });

  it("decodes percent-encoded cookie values", () => {
    const header = "user=Jane%20Doe%20%26%20Co; note=hello%2Fworld";
    expect(parseCookies(header)).toEqual({
      user: "Jane Doe & Co",
      note: "hello/world",
    });
  });

  it("handles malformed entries gracefully without throwing", () => {
    expect(parseCookies("malformed_cookie_without_equals; valid=1")).toEqual({
      malformed_cookie_without_equals: "",
      valid: "1",
    });
  });
});

describe("extractCaregiverToken", () => {
  it("extracts token from Bearer authorization header", () => {
    const req = {
      headers: {
        authorization: "Bearer my-secret-token",
      },
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res).toEqual({ token: "my-secret-token" });
  });

  it("extracts token from cookie when CSRF header matches csrf_token cookie", () => {
    const req = {
      headers: {
        cookie: "caregiver_token=cookie-tok; csrf_token=csrf-secret-123",
        "x-csrf-token": "csrf-secret-123",
      },
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res).toEqual({ token: "cookie-tok" });
  });

  it("returns 403 error when cookie token is present but X-CSRF-Token header is missing", () => {
    const req = {
      headers: {
        cookie: "caregiver_token=cookie-tok; csrf_token=csrf-secret-123",
      },
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res.error).toEqual({
      status: 403,
      message: "CSRF token mismatch or missing",
    });
    expect(res.token).toBeUndefined();
  });

  it("returns 403 error when cookie token is present but csrf_token cookie is missing", () => {
    const req = {
      headers: {
        cookie: "caregiver_token=cookie-tok",
        "x-csrf-token": "csrf-secret-123",
      },
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res.error).toEqual({
      status: 403,
      message: "CSRF token mismatch or missing",
    });
  });

  it("returns 403 error when X-CSRF-Token and csrf_token cookie differ in value or length", () => {
    const req = {
      headers: {
        cookie: "caregiver_token=cookie-tok; csrf_token=expected-csrf-token",
        "x-csrf-token": "wrong-csrf-token",
      },
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res.error).toEqual({
      status: 403,
      message: "CSRF token mismatch or missing",
    });
  });

  it("returns empty object when neither Authorization header nor caregiver_token cookie is present", () => {
    const req = {
      headers: {},
    } as unknown as Request;

    const res = extractCaregiverToken(req);
    expect(res).toEqual({});
  });
});

describe("requireCaregiverToken middleware", () => {
  const EXPECTED = "expected-caregiver-token-456";

  it("fails with 401 when no token is supplied", () => {
    const req = { headers: {} } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireCaregiverToken(EXPECTED)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({ error: "Missing caregiver token" });
  });

  it("passes when valid Bearer token matches", () => {
    const req = {
      headers: { authorization: `Bearer ${EXPECTED}` },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireCaregiverToken(EXPECTED)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes when valid cookie token and matching CSRF are supplied", () => {
    const req = {
      headers: {
        cookie: `caregiver_token=${EXPECTED}; csrf_token=valid-csrf`,
        "x-csrf-token": "valid-csrf",
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireCaregiverToken(EXPECTED)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails with 403 when token does not match", () => {
    const req = {
      headers: { authorization: "Bearer invalid-token" },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireCaregiverToken(EXPECTED)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid caregiver token" });
  });

  it("regression: rejects wrong-length tokens without throwing exceptions", () => {
    const wrongLengthTokens = [
      "",
      "x",
      "short",
      EXPECTED.slice(0, -1),
      `${EXPECTED}extra`,
      "x".repeat(5000),
    ];

    for (const wrongToken of wrongLengthTokens) {
      const req = {
        headers: { authorization: `Bearer ${wrongToken}` },
      } as unknown as Request;
      const res = createMockResponse();
      const next = vi.fn();

      expect(() => {
        requireCaregiverToken(EXPECTED)(req, res, next);
      }).not.toThrow();

      if (!wrongToken) {
        expect(res.status).toHaveBeenCalledWith(401);
      } else {
        expect(res.status).toHaveBeenCalledWith(403);
      }
    }
  });

  it("works directly as express middleware using process.env.CAREGIVER_TOKEN", () => {
    const prevEnv = process.env.CAREGIVER_TOKEN;
    process.env.CAREGIVER_TOKEN = "env-token-789";

    try {
      const validReq = {
        headers: { authorization: "Bearer env-token-789" },
      } as unknown as Request;
      const validRes = createMockResponse();
      const nextValid = vi.fn();

      requireCaregiverToken(validReq, validRes, nextValid);
      expect(nextValid).toHaveBeenCalledTimes(1);

      const invalidReq = {
        headers: { authorization: "Bearer wrong-token" },
      } as unknown as Request;
      const invalidRes = createMockResponse();
      const nextInvalid = vi.fn();

      requireCaregiverToken(invalidReq, invalidRes, nextInvalid);
      expect(nextInvalid).not.toHaveBeenCalled();
      expect(invalidRes.status).toHaveBeenCalledWith(403);
    } finally {
      process.env.CAREGIVER_TOKEN = prevEnv;
    }
  });
});

interface MockResponse extends Response {
  status: any;
  setHeader: any;
  json: any;
}

function createMockResponse(): MockResponse {
  const res = {} as any;
  res.status = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireApiKey middleware", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should call next() if AGENT_API_KEY is not configured and not in production", () => {
    delete process.env.AGENT_API_KEY;
    process.env.NODE_ENV = "test";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should fail-closed and return 401 if AGENT_API_KEY is not configured and in production", () => {
    delete process.env.AGENT_API_KEY;
    process.env.NODE_ENV = "production";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: AGENT_API_KEY is not configured",
    });
  });

  it("should call next() when the Authorization header is a valid Bearer token", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer super-secret-key",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should call next() when the apiKey is passed as a valid query param", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: "super-secret-key",
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should fail and return 401 when the Authorization header is incorrect", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer wrong-key",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when the query param key is incorrect", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: "wrong-key",
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when credentials are missing completely", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", "Bearer");
    expect(res.json).toHaveBeenCalledWith({
      error: "Unauthorized: Invalid AGENT_API_KEY",
    });
  });

  it("should fail and return 401 when the Authorization header is Bearer but with no key", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {
        authorization: "Bearer ",
      },
      query: {},
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("should fail and return 401 when apiKey query param is not a string", () => {
    process.env.AGENT_API_KEY = "super-secret-key";

    const req = {
      headers: {},
      query: {
        apiKey: ["key1", "key2"],
      },
    } as unknown as Request;
    const res = createMockResponse();
    const next = vi.fn();

    requireApiKey(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
