export type PharmacyWalletEnv = {
  MULTI_PHARMACY_MODE?: string;
  PHARMACY_1_PUBLIC_KEY?: string;
  PHARMACY_2_PUBLIC_KEY?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isMultiPharmacyModeEnabled(value?: string): boolean {
  return TRUE_VALUES.has((value ?? "").trim().toLowerCase());
}

export function resolveDrugInteractionPayTo(
  env: PharmacyWalletEnv = process.env,
): string {
  if (!env.PHARMACY_1_PUBLIC_KEY) {
    throw new Error("Missing PHARMACY_1_PUBLIC_KEY");
  }

  if (!isMultiPharmacyModeEnabled(env.MULTI_PHARMACY_MODE)) {
    return env.PHARMACY_1_PUBLIC_KEY;
  }

  if (!env.PHARMACY_2_PUBLIC_KEY) {
    throw new Error("Missing PHARMACY_2_PUBLIC_KEY");
  }

  return env.PHARMACY_2_PUBLIC_KEY;
}
