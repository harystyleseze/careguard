import { describe, it, expect, vi } from "vitest";
import {
  truncateKey,
  formatWalletTable,
  fetchAllWalletBalances,
  WALLET_CONFIGS,
} from "../check-wallet-balance.ts";

describe("check-wallet-balance script (Issue #3)", () => {
  it("defines all 6 CareGuard wallets in WALLET_CONFIGS", () => {
    expect(WALLET_CONFIGS).toHaveLength(6);
    const names = WALLET_CONFIGS.map((w) => w.name);
    expect(names).toEqual([
      "AGENT",
      "CAREGIVER",
      "PHARMACY_1",
      "PHARMACY_2",
      "PHARMACY_3",
      "BILL_PROVIDER",
    ]);
  });

  it("truncates public keys correctly", () => {
    expect(truncateKey(null)).toBe("NOT CONFIGURED");
    expect(truncateKey("SHORT")).toBe("SHORT");
    expect(truncateKey("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")).toBe(
      "GBBD...FLA5",
    );
  });

  it("formats wallet balance table with LOW highlights for sub-threshold balances", () => {
    const rows = [
      {
        name: "AGENT",
        publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        xlm: 0.5,
        usdc: 100.0,
      },
      {
        name: "CAREGIVER",
        publicKey: "GABC1234567890123456789012345678901234567890123456789012",
        xlm: 10.0,
        usdc: 0.2,
      },
    ];

    const output = formatWalletTable(rows, { usdc: 1.0, xlm: 1.0 });

    expect(output).toContain("CareGuard Wallet Balances:");
    expect(output).toContain("AGENT");
    expect(output).toContain("CAREGIVER");
    expect(output).toContain("0.50 (LOW)");
    expect(output).toContain("0.20 (LOW)");
    expect(output).toContain("\x1b[31m");
  });

  it("fetches balances for all 6 wallets using loadBalances mock", async () => {
    const mockLoadBalances = vi.fn(async (address: string) => ({
      address,
      usdc: 50.0,
      xlm: 100.0,
    }));

    const rows = await fetchAllWalletBalances({
      loadBalances: mockLoadBalances,
    });

    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(WALLET_CONFIGS.map((c) => c.name)).toContain(row.name);
    }
  });
});
