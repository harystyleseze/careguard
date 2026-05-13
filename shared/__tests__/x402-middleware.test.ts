import { describe, expect, it } from "vitest";
import { isRecoverableX402StartupError } from "../x402-middleware.ts";

describe("isRecoverableX402StartupError", () => {
  it("matches stable x402 facilitator error class names", () => {
    class X402FacilitatorError extends Error {
      name = "X402FacilitatorError";
    }

    expect(isRecoverableX402StartupError(new X402FacilitatorError("service unavailable"))).toBe(true);
  });

  it("keeps the current bazaar startup fallback narrow and visible", () => {
    const error = new Error("Failed to initialize bazaar facilitator supported payment kinds");

    expect(error.message).toMatchInlineSnapshot(
      `"Failed to initialize bazaar facilitator supported payment kinds"`,
    );
    expect(isRecoverableX402StartupError(error)).toBe(true);
  });

  it("does not swallow unrelated unhandled rejections", () => {
    expect(isRecoverableX402StartupError(new Error("database migration failed"))).toBe(false);
  });
});
