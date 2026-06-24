/**
 * Input sanitizer for user-supplied strings crossing API boundaries.
 *
 * Strips control characters, enforces a maximum length, and restricts
 * the character set to safe characters. Used to prevent injection of
 * newlines, Unicode RTL marks, and other characters that can break
 * downstream UI parsing (receipts, PDFs, TxLink displays).
 */

const MAX_LENGTH = 80;

// Allowed: alphanumeric, space, hyphen, parentheses
const SAFE_PATTERN = /[^a-zA-Z0-9 \-()]/g;

export function sanitizeUserString(input: unknown): string {
  if (typeof input !== "string") return "";
  // Strip control characters (U+0000–U+001F, U+007F, U+0080–U+009F)
  let s = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g, "");
  // Strip any remaining disallowed characters
  s = s.replace(SAFE_PATTERN, "");
  // Trim whitespace
  s = s.trim();
  // Cap length
  if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH);
  return s;
}
