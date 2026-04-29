import { describe, it, expect, vi, afterEach } from "vitest";
import { getLocalDateStr } from "../tz.ts";

// Isolated module — no external deps, no mocking needed.

describe("getLocalDateStr (Issue #19 — timezone-aware daily limit)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a YYYY-MM-DD string", () => {
    const d = getLocalDateStr("UTC", new Date("2024-06-15T12:00:00Z"));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the UTC date when timezone is UTC", () => {
    const d = getLocalDateStr("UTC", new Date("2024-06-15T12:00:00Z"));
    expect(d).toBe("2024-06-15");
  });

  it("uses the default (new Date()) when no date arg is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    expect(getLocalDateStr("UTC")).toBe("2024-06-15");
  });

  it("returns Phoenix date when clock is just before UTC midnight but past local midnight", () => {
    // UTC 2024-06-16T03:00:00Z = Phoenix 2024-06-15T20:00:00 (8 pm June 15)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-16T03:00:00Z"));
    expect(getLocalDateStr("America/Phoenix")).toBe("2024-06-15");
  });

  it("returns the next Phoenix day when clock is past local midnight", () => {
    // UTC 2024-06-16T09:00:00Z = Phoenix 2024-06-16T02:00:00 (2 am June 16)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-16T09:00:00Z"));
    expect(getLocalDateStr("America/Phoenix")).toBe("2024-06-16");
  });

  // Acceptance criterion: "tx at 11:30 pm local, 12:30 am local — different days"
  it("correctly identifies 11:30 pm and 12:30 am local timestamps as different days", () => {
    // Phoenix is UTC-7 (MST, no DST year-round)
    // 2024-01-15T06:30:00Z = Phoenix 2024-01-14T23:30:00 (11:30 pm Jan 14)
    // 2024-01-15T07:30:00Z = Phoenix 2024-01-15T00:30:00 (12:30 am Jan 15)
    const ts11pm = "2024-01-15T06:30:00.000Z";
    const ts12am = "2024-01-15T07:30:00.000Z";

    const d11pm = getLocalDateStr("America/Phoenix", new Date(ts11pm));
    const d12am = getLocalDateStr("America/Phoenix", new Date(ts12am));

    expect(d11pm).toBe("2024-01-14");
    expect(d12am).toBe("2024-01-15");
    expect(d11pm).not.toBe(d12am);
  });

  it("demonstrates the UTC-midnight bug: same UTC date is two Phoenix days", () => {
    // Both timestamps share UTC date 2024-06-16 but straddle Phoenix midnight
    const earlyUtc = "2024-06-16T00:00:00.000Z"; // Phoenix: June 15 5 pm
    const laterUtc = "2024-06-16T09:00:00.000Z"; // Phoenix: June 16 2 am

    // Old UTC-based approach would call both "2024-06-16" — wrong for Phoenix
    const utcEarly = earlyUtc.split("T")[0]; // "2024-06-16"
    const utcLater = laterUtc.split("T")[0]; // "2024-06-16"
    expect(utcEarly).toBe(utcLater); // both look like June 16 in UTC

    // New timezone-aware approach correctly places them on different Phoenix days
    const phoenixEarly = getLocalDateStr("America/Phoenix", new Date(earlyUtc));
    const phoenixLater = getLocalDateStr("America/Phoenix", new Date(laterUtc));
    expect(phoenixEarly).toBe("2024-06-15");
    expect(phoenixLater).toBe("2024-06-16");
    expect(phoenixEarly).not.toBe(phoenixLater);
  });

  it("handles Eastern timezone correctly", () => {
    // UTC 2024-03-15T03:00:00Z = Eastern 2024-03-14T23:00:00 (11 pm March 14, EST = UTC-5)
    const d = getLocalDateStr("America/New_York", new Date("2024-03-15T03:00:00Z"));
    expect(d).toBe("2024-03-14");
  });
});
