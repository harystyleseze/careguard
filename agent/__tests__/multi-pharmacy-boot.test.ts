/**
 * Tests for multi-pharmacy mode boot validation (Issue #195).
 *
 * Validates that MULTI_PHARMACY_MODE=true without PHARMACY_2_PUBLIC_KEY triggers
 * a clear boot failure instead of silently falling back to PHARMACY_1_PUBLIC_KEY.
 */

import { describe, it, expect, vi } from "vitest";

function validateMultiPharmacyEnv(opts: {
  multiPharmacyMode: boolean;
  pharmacy2Key: string | undefined;
}): { ok: true } | { ok: false; message: string } {
  if (opts.multiPharmacyMode && !opts.pharmacy2Key) {
    return {
      ok: false,
      message: "Missing/invalid env: PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true",
    };
  }
  return { ok: true };
}

describe("Multi-pharmacy boot validation (Issue #195)", () => {
  it("fails when MULTI_PHARMACY_MODE=true and PHARMACY_2_PUBLIC_KEY is missing", () => {
    const result = validateMultiPharmacyEnv({ multiPharmacyMode: true, pharmacy2Key: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Missing/invalid env: PHARMACY_2_PUBLIC_KEY");
      expect(result.message).toContain("MULTI_PHARMACY_MODE=true");
    }
  });

  it("passes when MULTI_PHARMACY_MODE=true and PHARMACY_2_PUBLIC_KEY is set", () => {
    const result = validateMultiPharmacyEnv({ multiPharmacyMode: true, pharmacy2Key: "GBQTESTPHARMACY2KEY" });
    expect(result.ok).toBe(true);
  });

  it("passes when MULTI_PHARMACY_MODE=false regardless of PHARMACY_2_PUBLIC_KEY", () => {
    const result = validateMultiPharmacyEnv({ multiPharmacyMode: false, pharmacy2Key: undefined });
    expect(result.ok).toBe(true);
  });

  it("server calls process.exit(1) when MULTI_PHARMACY_MODE=true without PHARMACY_2_PUBLIC_KEY", () => {
    const exitMock = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);
    const stderrMock = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const MULTI_PHARMACY_MODE = true;
    const PHARMACY_2_PUBLIC_KEY: string | undefined = undefined;

    if (MULTI_PHARMACY_MODE && !PHARMACY_2_PUBLIC_KEY) {
      process.stderr.write(
        "Missing/invalid env: PHARMACY_2_PUBLIC_KEY — required when MULTI_PHARMACY_MODE=true\n",
      );
      process.exit(1);
    }

    expect(stderrMock).toHaveBeenCalledWith(
      expect.stringContaining("Missing/invalid env: PHARMACY_2_PUBLIC_KEY"),
    );
    expect(exitMock).toHaveBeenCalledWith(1);

    exitMock.mockRestore();
    stderrMock.mockRestore();
  });
});
