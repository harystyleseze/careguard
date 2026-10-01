import { afterEach, describe, expect, it, vi } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

function setEnv(name: "NODE_ENV" | "NEXT_PUBLIC_API_URL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  Object.defineProperty(process.env, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
}

async function loadAgentUrl(nodeEnv: string, apiUrl?: string) {
  vi.resetModules();
  setEnv("NODE_ENV", nodeEnv);
  setEnv("NEXT_PUBLIC_API_URL", apiUrl);
  return import("../lib/agent-url");
}

describe("AGENT_URL", () => {
  afterEach(() => {
    setEnv("NODE_ENV", originalNodeEnv);
    setEnv("NEXT_PUBLIC_API_URL", originalApiUrl);
    vi.restoreAllMocks();
  });

  it("uses NEXT_PUBLIC_API_URL when configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { AGENT_URL } = await loadAgentUrl(
      "production",
      "https://api.example.com",
    );

    expect(AGENT_URL).toBe("https://api.example.com");
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses production without NEXT_PUBLIC_API_URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { AGENT_URL } = await loadAgentUrl("production");

    expect(AGENT_URL).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to localhost in development and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { AGENT_URL } = await loadAgentUrl("development");

    expect(AGENT_URL).toBe("http://localhost:3004");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("NEXT_PUBLIC_API_URL is not set"),
    );
  });
});
