import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveWalletsFromSeed,
  DEV_SEED_FILE,
  fundAccount,
  fundWalletWithCheckpoint,
  isMnemonicSeed,
  loadSetupWalletCheckpoint,
  resolveSetupSeed,
  SETUP_WALLET_CHECKPOINT_FILE,
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

describe("setup-wallets Friendbot funding", () => {
  const noWait = async () => {};

  it("retries transient Friendbot HTTP failures before succeeding", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      fundAccount("GTRANSIENT", { fetchFn, sleepFn: noWait }),
    ).resolves.toBe("funded");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("retries transient network failures before succeeding", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      fundAccount("GNETWORK", { fetchFn, sleepFn: noWait }),
    ).resolves.toBe("funded");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails permanent Friendbot validation errors without retrying", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("invalid Stellar address", { status: 400 }));

    await expect(
      fundAccount("GBAD", { fetchFn, sleepFn: noWait }),
    ).rejects.toThrow(/permanent HTTP 400/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("treats already-funded accounts as success", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("createAccountAlreadyExist", { status: 400 }));

    await expect(
      fundAccount("GEXISTS", { fetchFn, sleepFn: noWait }),
    ).resolves.toBe("already_exists");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("writes a checkpoint after funding and skips that wallet on rerun", async () => {
    const cwd = tempDir();
    const [wallet] = deriveWalletsFromSeed("checkpoint-seed");
    const fetchFn = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const now = () => new Date("2026-06-27T00:00:00.000Z");

    await expect(
      fundWalletWithCheckpoint(wallet, { cwd, fetchFn, sleepFn: noWait, now }),
    ).resolves.toBe("funded");

    const checkpointFile = path.join(cwd, SETUP_WALLET_CHECKPOINT_FILE);
    expect(existsSync(checkpointFile)).toBe(true);
    const checkpoint = loadSetupWalletCheckpoint(checkpointFile);
    expect(checkpoint.funded[wallet.name]).toEqual({
      publicKey: wallet.publicKey,
      fundedAt: "2026-06-27T00:00:00.000Z",
    });

    fetchFn.mockClear();
    await expect(
      fundWalletWithCheckpoint(wallet, { cwd, fetchFn, sleepFn: noWait, now }),
    ).resolves.toBe("skipped");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
