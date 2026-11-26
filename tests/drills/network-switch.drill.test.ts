/**
 * Game-Day Drill #967: Runtime STELLAR_NETWORK switch & startup guard invariants.
 *
 * Verifies:
 * 1. `resolveStellarNetwork()` maps `testnet` and `public` to distinct Horizon URLs & passphrases.
 * 2. `server.ts` enforces the startup guard for `STELLAR_NETWORK=public` without `OZ_FACILITATOR_API_KEY`.
 * 3. `server.ts` enforces the startup guard for `MULTI_PHARMACY_MODE=true` without `PHARMACY_2_PUBLIC_KEY`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { resolveStellarNetwork } from "../../shared/stellar-network.ts";

describe("Drill #967: STELLAR_NETWORK switch & startup guards", () => {
  it("resolves distinct Horizon URLs and passphrases for testnet vs public", () => {
    const testnet = resolveStellarNetwork({ STELLAR_NETWORK: "testnet" });
    const pub = resolveStellarNetwork({ STELLAR_NETWORK: "public" });

    expect(testnet.networkType).toBe("testnet");
    expect(testnet.horizonUrl).toBe("https://horizon-testnet.stellar.org");

    expect(pub.networkType).toBe("public");
    expect(pub.horizonUrl).toBe("https://horizon.stellar.org");
    expect(pub.networkPassphrase).not.toBe(testnet.networkPassphrase);
  });

  it("rejects invalid STELLAR_NETWORK values", () => {
    expect(() => resolveStellarNetwork({ STELLAR_NETWORK: "futurenet" })).toThrow(
      /Invalid STELLAR_NETWORK/,
    );
  });

  it("server.ts contains startup guards for public network and multi-pharmacy mode", () => {
    const serverSrc = readFileSync(resolve(process.cwd(), "server.ts"), "utf-8");

    expect(serverSrc).toContain(
      'env.data.STELLAR_NETWORK === "public" && !env.data.OZ_FACILITATOR_API_KEY',
    );
    expect(serverSrc).toContain(
      "Missing/invalid env: OZ_FACILITATOR_API_KEY — required when STELLAR_NETWORK=public",
    );

    expect(serverSrc).toContain("MULTI_PHARMACY_MODE && !process.env.PHARMACY_2_PUBLIC_KEY");
    expect(serverSrc).toContain(
      "Missing/invalid env: PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true",
    );
  });
});
