import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveWalletsFromSeed,
  DEV_SEED_FILE,
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
