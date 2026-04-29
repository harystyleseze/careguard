// Stellar seed key format: S + 55 chars from uppercase A-Z and digits 2-7 (base32 alphabet)
const STELLAR_SEED_RE = /^S[A-Z2-7]{55}$/;

/**
 * Asserts that `value` is a valid Stellar secret seed (56-char S-prefix base32 string).
 * Throws with a clear, actionable message if not.
 */
export function validateStellarSeed(name: string, value: string | undefined): void {
  if (STELLAR_SEED_RE.test(value ?? "")) return;

  let hint: string;
  if (!value) {
    hint = "value is empty or missing";
  } else if (value[0] !== "S") {
    hint = `must start with 'S', got '${value[0]}'`;
  } else if (value.length !== 56) {
    hint = `must be 56 chars, got ${value.length}`;
  } else {
    hint = "contains invalid characters (allowed: uppercase A–Z and digits 2–7)";
  }

  throw new Error(
    `${name} is malformed. It must be a 56-char Stellar seed starting with S. ` +
      `Run 'npm run setup' to generate one. (${hint})`
  );
}

/**
 * Validates a seed only when it is set in the environment.
 * Keys that are optional (not required by the running server) are still validated
 * if present so misconfigured values are caught early.
 */
export function validateStellarSeedIfPresent(name: string, value: string | undefined): void {
  if (!value) return;
  validateStellarSeed(name, value);
}
