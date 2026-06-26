import { describe, expect, it } from "vitest";
import {
  assertMockNetworkAllowed,
  createMockReceipt,
  isMockNetwork,
} from "../network-mode.ts";

describe("network mode", () => {
  it("detects mock mode only when MOCK_NETWORK=1", () => {
    expect(isMockNetwork({ MOCK_NETWORK: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMockNetwork({ MOCK_NETWORK: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("forbids mock network mode in production", () => {
    expect(() =>
      assertMockNetworkAllowed({
        MOCK_NETWORK: "1",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toThrow(/forbidden/);
  });

  it("returns deterministic fake receipts", () => {
    const first = createMockReceipt("x402:test", { amount: 1 });
    const second = createMockReceipt("x402:test", { amount: 1 });
    expect(first).toEqual(second);
    expect(first.stellarTxHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
