import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  shouldSendNotification,
} from "../notifications.ts";

describe("notification preferences", () => {
  it("keeps the default policy-blocked and approval-needed channels enabled", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES["policy-blocked"].email).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES["approval-needed"].slack).toBe(true);
  });

  it("protects critical alerts from being fully disabled", () => {
    const prefs = {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      "critical-safety": { email: false, sms: false, slack: false },
    };

    expect(shouldSendNotification("critical-safety", "email", prefs)).toBe(true);
    expect(shouldSendNotification("critical-safety", "sms", prefs)).toBe(true);
    expect(shouldSendNotification("critical-safety", "slack", prefs)).toBe(true);
  });
});
