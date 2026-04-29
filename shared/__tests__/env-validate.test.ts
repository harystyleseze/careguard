import { describe, it, expect } from "vitest";
import { validateStellarSeed, validateStellarSeedIfPresent } from "../env-validate.ts";

// S + 55 chars from A-Z and 2-7 = valid 56-char Stellar seed format
const VALID_SEED = "S" + "A".repeat(55);

describe("validateStellarSeed", () => {
  it("accepts a valid Stellar seed", () => {
    expect(() => validateStellarSeed("KEY", VALID_SEED)).not.toThrow();
  });

  it("accepts seeds using all allowed base32 characters", () => {
    // Base32 alphabet: A-Z and 2-7. Repeat to fill 55 chars after S.
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const seed = "S" + (alphabet + alphabet).slice(0, 55);
    expect(() => validateStellarSeed("KEY", seed)).not.toThrow();
  });

  it("throws on empty string", () => {
    expect(() => validateStellarSeed("KEY", "")).toThrow(/KEY is malformed/);
  });

  it("throws on undefined", () => {
    expect(() => validateStellarSeed("KEY", undefined)).toThrow(/KEY is malformed/);
  });

  it("throws on wrong prefix (G instead of S)", () => {
    expect(() => validateStellarSeed("KEY", "G" + "A".repeat(55))).toThrow(
      /must start with 'S'/
    );
  });

  it("throws on wrong length — too short", () => {
    expect(() => validateStellarSeed("KEY", "S" + "A".repeat(40))).toThrow(/must be 56 chars/);
  });

  it("throws on wrong length — too long", () => {
    expect(() => validateStellarSeed("KEY", "S" + "A".repeat(60))).toThrow(/must be 56 chars/);
  });

  it("throws on lowercase s prefix", () => {
    expect(() => validateStellarSeed("KEY", "s" + "a".repeat(55))).toThrow(/KEY is malformed/);
  });

  it("throws on all-lowercase seed", () => {
    expect(() => validateStellarSeed("KEY", "s" + "abcdefghij".repeat(5) + "abcde")).toThrow(
      /KEY is malformed/
    );
  });

  it("throws on seed containing digit 0 (not in base32)", () => {
    // 0 is not in Stellar base32 alphabet
    expect(() => validateStellarSeed("KEY", "S" + "0".repeat(55))).toThrow(
      /contains invalid characters/
    );
  });

  it("error message includes the env var name", () => {
    expect(() => validateStellarSeed("AGENT_SECRET_KEY", "bad")).toThrow(/AGENT_SECRET_KEY/);
  });

  it("error message references the setup script", () => {
    expect(() => validateStellarSeed("KEY", "bad")).toThrow(/npm run setup/);
  });
});

describe("validateStellarSeedIfPresent", () => {
  it("does not throw when value is undefined", () => {
    expect(() => validateStellarSeedIfPresent("KEY", undefined)).not.toThrow();
  });

  it("does not throw when value is empty string", () => {
    // Empty string means the key is not configured — skip validation
    expect(() => validateStellarSeedIfPresent("KEY", "")).not.toThrow();
  });

  it("throws when value is set but malformed", () => {
    expect(() => validateStellarSeedIfPresent("KEY", "SNOTVALID")).toThrow(/KEY is malformed/);
  });

  it("accepts a valid seed", () => {
    expect(() => validateStellarSeedIfPresent("KEY", VALID_SEED)).not.toThrow();
  });
});
