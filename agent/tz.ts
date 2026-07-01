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

function getDatePart(
  tz: string,
  date: Date,
  field: "year" | "month" | "day" | "hour" | "minute" | "second",
) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const part = formatter
    .formatToParts(date)
    .find((entry) => entry.type === field);

  if (!part) {
    throw new Error(`Unable to resolve ${field} for timezone ${tz}`);
  }

  return parseInt(part.value, 10);
}

function getTimeZoneOffsetMs(tz: string, date: Date) {
  const year = getDatePart(tz, date, "year");
  const month = getDatePart(tz, date, "month");
  const day = getDatePart(tz, date, "day");
  const hour = getDatePart(tz, date, "hour");
  const minute = getDatePart(tz, date, "minute");
  const second = getDatePart(tz, date, "second");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

function getLocalMidnightUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
) {
  const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  let candidate = new Date(utcMidnight);

  // Iterate to converge on the UTC instant that renders as local midnight.
  for (let attempt = 0; attempt < 3; attempt++) {
    const offsetMs = getTimeZoneOffsetMs(tz, candidate);
    candidate = new Date(utcMidnight - offsetMs);
  }

  return candidate;
}

export function getLocalDayBounds(tz: string, date: Date = new Date()) {
  const year = getDatePart(tz, date, "year");
  const month = getDatePart(tz, date, "month");
  const day = getDatePart(tz, date, "day");

  return {
    dayStart: getLocalMidnightUtc(tz, year, month, day),
    dayEnd: getLocalMidnightUtc(tz, year, month, day + 1),
  };
}
