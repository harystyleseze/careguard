import { describe, expect, it, vi } from "vitest";
import { resolveAgentUrl } from "../lib/agent-url";

describe("resolveAgentUrl", () => {
  it("uses NEXT_PUBLIC_API_URL when configured", () => {
    const logger = { warn: vi.fn() };
    expect(resolveAgentUrl("production", " https://api.example.com ", logger)).toEqual({
      agentUrl: "https://api.example.com",
      missingRequiredEnv: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("refuses production without NEXT_PUBLIC_API_URL", () => {
    const logger = { warn: vi.fn() };
    const config = resolveAgentUrl("production", undefined, logger);
    expect(config.missingRequiredEnv).toBe(true);
    if (config.missingRequiredEnv) {
      expect(config.envName).toBe("NEXT_PUBLIC_API_URL");
      expect(config.message).toMatch(/missing NEXT_PUBLIC_API_URL/i);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("falls back to localhost in development and warns", () => {
    const logger = { warn: vi.fn() };
    const config = resolveAgentUrl("development", undefined, logger);
    expect(config).toMatchObject({
      agentUrl: "http://localhost:3004",
      missingRequiredEnv: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_API_URL is not set"),
    );
  });
});
