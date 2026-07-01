import { describe, expect, it, vi, beforeEach } from "vitest";
import { fundAccountWithRetry, verifyFundedBalance } from "../setup-wallets.ts";

const mockLoadAccount = vi.fn();
const mockHorizonServer = { loadAccount: mockLoadAccount } as any;

function okResponse() {
  return new Response(JSON.stringify({ _links: {} }), { status: 200 });
}
function alreadyFundedResponse() {
  return new Response("createAccountAlreadyExist", { status: 400 });
}
function transientResponse(status: number) {
  return new Response("Service Unavailable", { status });
}

function nativeBalance(amount: string) {
  return {
    balances: [{ asset_type: "native", balance: amount }],
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(globalThis, "fetch");
  mockLoadAccount.mockResolvedValue(nativeBalance("10000.0000000"));
});

describe("fundAccountWithRetry (#279)", () => {
  it("succeeds on first attempt and verifies balance", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse());
    await expect(
      fundAccountWithRetry("GPUB123", mockHorizonServer),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockLoadAccount).toHaveBeenCalledWith("GPUB123");
  });

  it("succeeds on second attempt after a 503", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(transientResponse(503))
      .mockResolvedValueOnce(okResponse());
    vi.useFakeTimers();
    const promise = fundAccountWithRetry("GPUB123", mockHorizonServer);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("handles already-funded account and verifies balance", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(alreadyFundedResponse());
    await expect(
      fundAccountWithRetry("GPUB123", mockHorizonServer),
    ).resolves.toBeUndefined();
    expect(mockLoadAccount).toHaveBeenCalledWith("GPUB123");
  });

  it("throws after exhausting all retries on persistent 503", async () => {
    vi.mocked(fetch).mockResolvedValue(transientResponse(503));
    vi.useFakeTimers();
    const promise = fundAccountWithRetry("GPUB123", mockHorizonServer);
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow(/Friendbot|Failed to fund/);
    vi.useRealTimers();
  });

  it("throws when Horizon confirms zero XLM balance after funding", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(okResponse());
    mockLoadAccount.mockResolvedValueOnce(nativeBalance("0.0000000"));
    await expect(
      fundAccountWithRetry("GPUB123", mockHorizonServer),
    ).rejects.toThrow(/Balance verification failed/);
  });
});

describe("verifyFundedBalance (#279)", () => {
  it("resolves when XLM balance is positive", async () => {
    mockLoadAccount.mockResolvedValueOnce(nativeBalance("5000.0000000"));
    await expect(
      verifyFundedBalance("GPUB123", mockHorizonServer),
    ).resolves.toBeUndefined();
  });

  it("rejects when XLM balance is zero", async () => {
    mockLoadAccount.mockResolvedValueOnce(nativeBalance("0.0000000"));
    await expect(
      verifyFundedBalance("GPUB123", mockHorizonServer),
    ).rejects.toThrow(/Balance verification failed/);
  });

  it("rejects when no native balance entry exists", async () => {
    mockLoadAccount.mockResolvedValueOnce({ balances: [] });
    await expect(
      verifyFundedBalance("GPUB123", mockHorizonServer),
    ).rejects.toThrow(/Balance verification failed/);
  });
});
