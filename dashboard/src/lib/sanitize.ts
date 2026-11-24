/**
 * Re-exports from shared/sanitize.ts so dashboard components can import
 * sanitization utilities without crossing rootDir boundaries.
 *
 * Keep this file in sync with shared/sanitize.ts.
 */

const MAX_LENGTH = 80;
const SAFE_PATTERN = /[^a-zA-Z0-9 \-()]/g;

export function sanitizeUserString(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g, "");
  s = s.replace(SAFE_PATTERN, "");
  s = s.trim();
  if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH);
  return s;
}

/** Maximum length for a free-text caregiver annotation on a bill line item. */
const ANNOTATION_MAX_LENGTH = 280;
const ANNOTATION_SAFE_PATTERN = /[^a-zA-Z0-9 \-().,':/?@#&+%!]/g;

export function sanitizeAnnotation(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g, "");
  s = s.replace(ANNOTATION_SAFE_PATTERN, "");
  s = s.trim();
  if (s.length > ANNOTATION_MAX_LENGTH) s = s.slice(0, ANNOTATION_MAX_LENGTH);
  return s;
}
