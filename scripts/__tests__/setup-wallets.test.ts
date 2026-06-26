import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveWalletsFromSeed,
  DEV_SEED_FILE,
  FRIENDBOT_RETRY_BACKOFF_MS,
  fundAccount,
  isMnemonicSeed,
  resolveSetupSeed,
} from "../setup-wallets.ts";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.DEV_WALLET_SEED;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "careguard-wallets-"));
  tempDirs.push(dir);
  return dir;
}

describe("setup-wallets seed handling", () => {
  it("derives the same six wallets from the same BIP-39 mnemonic", () => {
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const first = deriveWalletsFromSeed(mnemonic);
    const second = deriveWalletsFromSeed(mnemonic);

    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(new Set(first.map((wallet) => wallet.publicKey)).size).toBe(6);
  });

  it("derives the same six wallets from the same seed", () => {
    const first = deriveWalletsFromSeed("repeatable-dev-seed");
    const second = deriveWalletsFromSeed("repeatable-dev-seed");

    expect(first).toEqual(second);
    expect(first).toHaveLength(6);
    expect(new Set(first.map((wallet) => wallet.publicKey)).size).toBe(6);
  });

  it("uses an explicit seed without writing .dev-seed", async () => {
    const cwd = tempDir();
    const result = await resolveSetupSeed({ cwd, seed: "provided-seed" });

    expect(result).toEqual({ seed: "provided-seed", source: "provided" });
  });

  it("writes .dev-seed on first approved run and reuses it later", async () => {
    const cwd = tempDir();
    const first = await resolveSetupSeed({
      cwd,
      confirmGenerate: async () => true,
    });
    const second = await resolveSetupSeed({
      cwd,
      confirmGenerate: async () => {
        throw new Error("should not prompt when seed exists");
      },
    });

    expect(first.source).toBe("generated");
    expect(second.source).toBe("file");
    expect(second.seed).toBe(first.seed);
    expect(isMnemonicSeed(first.seed)).toBe(true);
    expect(readFileSync(path.join(cwd, DEV_SEED_FILE), "utf-8").trim()).toBe(first.seed);
  });

  it("fails without a seed when generation is not confirmed", async () => {
    await expect(
      resolveSetupSeed({
        cwd: tempDir(),
        confirmGenerate: async () => false,
      }),
    ).rejects.toThrow(/Aborted/);
  });
});

describe("Friendbot funding retries", () => {
  const publicKey = "GTESTFRIENDBOTACCOUNT";
  const fundedAccount = {
    balances: [{ asset_type: "native", balance: "10000.0000000" }],
  };

  function response(ok: boolean, text = "") {
    return {
      ok,
      text: async () => text,
    } as Response;
  }

  it("returns after a successful Friendbot response and Horizon balance verification", async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(true));
    const server = { loadAccount: vi.fn().mockResolvedValue(fundedAccount) };

    await fundAccount(publicKey, { fetchFn, server });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(server.loadAccount).toHaveBeenCalledWith(publicKey);
  });

  it("retries transient Friendbot failures with exponential backoff before success", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(response(false, "temporary unavailable"))
      .mockResolvedValueOnce(response(true));
    const server = { loadAccount: vi.fn().mockResolvedValue(fundedAccount) };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fundAccount(publicKey, { fetchFn, server, sleep });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it("retries until total failure and reports the last Friendbot error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(false, "rate limited"));
    const server = { loadAccount: vi.fn().mockResolvedValue(fundedAccount) };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fundAccount(publicKey, { fetchFn, server, sleep })).rejects.toThrow(
      /after 6 attempts: Friendbot failed.*rate limited/,
    );

    expect(fetchFn).toHaveBeenCalledTimes(FRIENDBOT_RETRY_BACKOFF_MS.length + 1);
    expect(sleep).toHaveBeenCalledTimes(FRIENDBOT_RETRY_BACKOFF_MS.length);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      1000,
      2000,
      4000,
      8000,
      16000,
    ]);
  });

  it("retries when Friendbot responds but Horizon does not show a native balance", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response(true));
    const server = {
      loadAccount: vi
        .fn()
        .mockResolvedValueOnce({ balances: [] })
        .mockResolvedValueOnce(fundedAccount),
    };
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fundAccount(publicKey, { fetchFn, server, sleep });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});
