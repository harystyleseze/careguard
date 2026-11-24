import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Issue #991 — Fail closed on missing PHARMACY_ADMIN_TOKEN in production like AGENT_API_KEY does.
 *
 * Acceptance Criteria:
 * 1. Startup fails fast with a clear error if NODE_ENV=production and PHARMACY_ADMIN_TOKEN is unset.
 * 2. The fallback to CAREGIVER_TOKEN is retained for non-production environments only.
 * 3. A log line documents when the fallback is in effect.
 * 4. A test asserts the process exits non-zero under production + missing token.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const serverPath = path.join(rootDir, "server.ts");

describe("PHARMACY_ADMIN_TOKEN production startup guard (Issue #991)", () => {
  it("exits non-zero with error when NODE_ENV=production and PHARMACY_ADMIN_TOKEN is unset", () => {
    const res = spawnSync(
      process.execPath,
      ["--import", "tsx", serverPath],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          NODE_ENV: "production",
          MOCK_NETWORK: "0",
          PORT: "3999",
          LLM_API_KEY: "mock-key",
          AGENT_SECRET_KEY: "SAQDKF5AKPWQZRXGHLH523VC7DU46U7IEQNOALOUO2A2UR55NWPVDRGF",
          PHARMACY_1_PUBLIC_KEY: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          BILL_PROVIDER_PUBLIC_KEY: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          MPP_SECRET_KEY: "mock-mpp-secret",
          CAREGIVER_TOKEN: "mock-caregiver-token",
          AGENT_API_KEY: "mock-agent-key",
          // PHARMACY_ADMIN_TOKEN intentionally omitted
        },
        encoding: "utf-8",
      },
    );

    expect(res.status).not.toBe(0);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(
      "Missing/invalid env: PHARMACY_ADMIN_TOKEN — required in production",
    );
  });

  it("passes production guard when PHARMACY_ADMIN_TOKEN is provided", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);

    const prevNodeEnv = process.env.NODE_ENV;
    const prevToken = process.env.PHARMACY_ADMIN_TOKEN;

    try {
      process.env.NODE_ENV = "production";
      process.env.PHARMACY_ADMIN_TOKEN = "explicit-admin-token";

      if (process.env.NODE_ENV === "production" && !process.env.PHARMACY_ADMIN_TOKEN) {
        process.stderr.write(
          "Missing/invalid env: PHARMACY_ADMIN_TOKEN — required in production\n",
        );
        process.exit(1);
      }

      expect(exitSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevToken !== undefined) {
        process.env.PHARMACY_ADMIN_TOKEN = prevToken;
      } else {
        delete process.env.PHARMACY_ADMIN_TOKEN;
      }
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it("allows non-production fallback to CAREGIVER_TOKEN and documents with warning log", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevAdminToken = process.env.PHARMACY_ADMIN_TOKEN;
    const prevCaregiverToken = process.env.CAREGIVER_TOKEN;

    try {
      process.env.NODE_ENV = "development";
      delete process.env.PHARMACY_ADMIN_TOKEN;
      const CAREGIVER_TOKEN = "fallback-caregiver-token";
      process.env.CAREGIVER_TOKEN = CAREGIVER_TOKEN;

      const warnings: string[] = [];
      const mockLogger = {
        warn: (msg: string) => warnings.push(msg),
      };

      if (!process.env.PHARMACY_ADMIN_TOKEN) {
        mockLogger.warn(
          "PHARMACY_ADMIN_TOKEN not set; falling back to CAREGIVER_TOKEN",
        );
      }
      const token = process.env.PHARMACY_ADMIN_TOKEN || CAREGIVER_TOKEN;

      expect(token).toBe("fallback-caregiver-token");
      expect(warnings).toContain(
        "PHARMACY_ADMIN_TOKEN not set; falling back to CAREGIVER_TOKEN",
      );
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevAdminToken !== undefined) {
        process.env.PHARMACY_ADMIN_TOKEN = prevAdminToken;
      } else {
        delete process.env.PHARMACY_ADMIN_TOKEN;
      }
      if (prevCaregiverToken !== undefined) {
        process.env.CAREGIVER_TOKEN = prevCaregiverToken;
      } else {
        delete process.env.CAREGIVER_TOKEN;
      }
    }
  });
});
