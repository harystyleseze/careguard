/**
 * Timezone utilities for spending policy enforcement.
 * Isolated here so tests can import without pulling in heavy payment-SDK deps.
 */

export const SPENDING_TIMEZONE = process.env.SPENDING_TIMEZONE ?? "America/Phoenix";

/**
 * Returns the local date string (YYYY-MM-DD) for `date` in the given IANA timezone.
 * Uses `en-CA` locale which formats as YYYY-MM-DD by default.
 */
export function getLocalDateStr(tz: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
