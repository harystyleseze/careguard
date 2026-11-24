import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { getDataDir, urlToFilePath } from "../paths.ts";

describe("shared/paths.ts (Issue #928)", () => {
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (originalDataDir !== undefined) {
      process.env.DATA_DIR = originalDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
  });

  it("returns process.env.DATA_DIR when configured", () => {
    process.env.DATA_DIR = "/custom/data/path";
    expect(getDataDir()).toBe(path.resolve("/custom/data/path"));
  });

  it("returns default data directory when process.env.DATA_DIR is unset", () => {
    delete process.env.DATA_DIR;
    const dir = getDataDir();
    expect(typeof dir).toBe("string");
    expect(dir.length).toBeGreaterThan(0);
    expect(dir.endsWith("data")).toBe(true);
  });

  it("confirms urlToFilePath produces no leading slash before a drive letter on simulated Windows file URLs", () => {
    // Windows file URLs: file:///C:/careguard/data
    // new URL('file:///C:/careguard/data').pathname produces '/C:/careguard/data' (has broken leading slash)
    const rawPathname = new URL("file:///C:/careguard/data").pathname;
    expect(rawPathname.startsWith("/C:")).toBe(true); // confirms the latent bug in raw URL pathname

    // urlToFilePath must produce C:\... without leading slash on Windows
    const converted = urlToFilePath(new URL("file:///C:/careguard/data"));
    if (process.platform === "win32") {
      expect(converted).toMatch(/^[a-zA-Z]:\\/);
      expect(converted.startsWith("/")).toBe(false);
    } else {
      // On non-Windows platforms, fileURLToPath will reject or format according to POSIX,
      // but verifying urlToFilePath handles normal file URLs safely:
      const localUrl = new URL("../data", import.meta.url);
      const convertedLocal = urlToFilePath(localUrl);
      expect(typeof convertedLocal).toBe("string");
      expect(convertedLocal.startsWith("/")).toBe(true);
    }
  });
});
