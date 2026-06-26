import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnvFile, loadEnvFileOrExit } from "../env-file.ts";

function writeTempEnv(contents: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "careguard-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, contents);
  return { dir, path };
}

describe("env-file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads valid .env values without overwriting existing variables", () => {
    const { dir, path } = writeTempEnv([
      "# local config",
      "LLM_API_KEY=from-file",
      "PHARMACY_API_URL: http://localhost:3001",
      "export BILL_AUDIT_API_URL=http://localhost:3002",
    ].join("\n"));
    const env = {
      LLM_API_KEY: "already-set",
    } as NodeJS.ProcessEnv;

    try {
      const result = loadEnvFile({ path, env });

      expect(result).toMatchObject({ loaded: true, path });
      expect(result.error).toBeUndefined();
      expect(env.LLM_API_KEY).toBe("already-set");
      expect(env.PHARMACY_API_URL).toBe("http://localhost:3001");
      expect(env.BILL_AUDIT_API_URL).toBe("http://localhost:3002");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts files with a UTF-8 BOM", () => {
    const { dir, path } = writeTempEnv("\uFEFFLLM_API_KEY=from-file\n");
    const env = {} as NodeJS.ProcessEnv;

    try {
      const result = loadEnvFile({ path, env });

      expect(result.error).toBeUndefined();
      expect(env.LLM_API_KEY).toBe("from-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a clear parse error for malformed .env syntax", () => {
    const { dir, path } = writeTempEnv('LLM_API_KEY="unterminated\n');

    try {
      const result = loadEnvFile({ path, env: {} as NodeJS.ProcessEnv });

      expect(result.loaded).toBe(false);
      expect(result.error?.message).toBe('line 1: unbalanced " quote');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints a clean parse message and exits on malformed .env files", () => {
    const { dir, path } = writeTempEnv("not valid dotenv syntax\n");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number | string | null) => {
      throw new Error(`exit:${code}`);
    }) as never);

    try {
      expect(() => loadEnvFileOrExit({ path })).toThrow("exit:1");
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to parse .env: line 1: expected KEY=value",
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
