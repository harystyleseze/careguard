/**
 * PHI scrubbing for LLM prompts (issue #97).
 *
 * Replaces real patient/caregiver names with consistent pseudonyms before
 * sending prompts to external LLM providers. A server-side mapping table
 * lets agent tool calls still reference real wallet IDs and data — only the
 * text sent to the LLM is pseudonymised.
 *
 * Disable via LLM_PII_SCRUB=false for providers with a signed BAA
 * (e.g. enterprise OpenAI).
 */

const LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export interface ScrubSession {
  /** Maps a real name to its pseudonym (e.g. "Rosa Garcia" → "Patient A"). */
  realToAlias: Map<string, string>;
  /** Inverse map — kept server-side for cross-referencing tool results. */
  aliasToReal: Map<string, string>;
}

export function buildScrubSession(
  patients: string[],
  caregivers: string[]
): ScrubSession {
  const realToAlias = new Map<string, string>();
  const aliasToReal = new Map<string, string>();

  patients.forEach((name, i) => {
    const alias = `Patient ${LABELS[i] ?? String(i + 1)}`;
    realToAlias.set(name, alias);
    aliasToReal.set(alias, name);
  });

  caregivers.forEach((name, i) => {
    const alias = `Caregiver ${LABELS[i] ?? String(i + 1)}`;
    realToAlias.set(name, alias);
    aliasToReal.set(alias, name);
  });

  return { realToAlias, aliasToReal };
}

export function scrubText(text: string, session: ScrubSession): string {
  let out = text;
  for (const [real, alias] of session.realToAlias) {
    out = out.replaceAll(real, alias);
  }
  return out;
}
