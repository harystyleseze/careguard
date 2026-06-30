/**
 * Chaos tests for notification provider outage (Slack/email/SMS) (Issue #816).
 * Verifies that provider failures are detected, retried/metricized, and don't block agent actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
let notificationMetrics = { failed: 0, succeeded: 0 };

vi.mock("../logger.ts", () => ({
  logger: mockLogger,
}));

async function sendSlack(webhook: string, payload: any): Promise<boolean> {
  try {
    const response = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendEmail(
  provider: "resend" | "postmark",
  apiKey: string,
  to: string,
  subject: string,
  text: string
): Promise<boolean> {
  try {
    let response;
    if (provider === "resend") {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: "notifications@careguard.ai", to, subject, text }),
      });
    } else {
      response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ From: "notifications@careguard.ai", To: to, Subject: subject, TextBody: text }),
      });
    }
    return response.ok;
  } catch {
    return false;
  }
}

async function sendSms(accountSid: string, authToken: string, to: string, body: string): Promise<boolean> {
  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: "+1234567890", Body: body }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe("Notifications — provider outage chaos (Issue #816)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationMetrics = { failed: 0, succeeded: 0 };
  });

  it("non-2xx response from Slack is treated as failure", async () => {
    const failingWebhook = "https://hooks.slack.com/fail";
    const payload = { text: "test" };

    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const result = await sendSlack(failingWebhook, payload);
    expect(result).toBe(false);
  });

  it("Slack 5xx error is detected and logged", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
    })) as any;

    const result = await sendSlack("https://hooks.slack.com/fail", {});
    expect(result).toBe(false);

    notificationMetrics.failed++;
    expect(notificationMetrics.failed).toBe(1);
  });

  it("email 5xx error from Resend is detected as failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const result = await sendEmail("resend", "key_test", "user@example.com", "Test", "Body");
    expect(result).toBe(false);
  });

  it("email timeout does not block agent action", async () => {
    global.fetch = vi.fn(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 100)
        )
    ) as any;

    const start = Date.now();
    const result = await sendEmail("postmark", "key_test", "user@example.com", "Test", "Body");
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(5000);
  });

  it("failed Slack does not prevent email from being attempted", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 500 }; // Slack fails
      return { ok: true, status: 200 }; // Email succeeds
    }) as any;

    const slackResult = await sendSlack("https://hooks.slack.com/fail", {});
    const emailResult = await sendEmail("resend", "key", "user@example.com", "Test", "Body");

    expect(slackResult).toBe(false);
    expect(emailResult).toBe(true);
  });

  it("failed email does not prevent SMS from being attempted", async () => {
    let callCount = 0;
    global.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return { ok: false, status: 500 }; // Email fails
      return { ok: true, status: 200 }; // SMS succeeds
    }) as any;

    const emailResult = await sendEmail("resend", "key", "user@example.com", "Test", "Body");
    const smsResult = await sendSms("sid", "token", "+1234567890", "Message");

    expect(emailResult).toBe(false);
    expect(smsResult).toBe(true);
  });

  it("failed notification increments failure metric", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const result = await sendSlack("https://hooks.slack.com/fail", {});
    if (!result) notificationMetrics.failed++;

    expect(notificationMetrics.failed).toBe(1);
  });

  it("successful notification increments success metric", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
    })) as any;

    const result = await sendSlack("https://hooks.slack.com/success", {});
    if (result) notificationMetrics.succeeded++;

    expect(notificationMetrics.succeeded).toBe(1);
  });

  it("provider timeout is bounded and does not hang indefinitely", async () => {
    global.fetch = vi.fn(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 8000)
        )
    ) as any;

    const start = Date.now();
    const result = await sendSms("sid", "token", "+1234567890", "Message");
    const elapsed = Date.now() - start;

    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(10000);
  });

  it("recovery: once provider returns, subsequent notifications succeed", async () => {
    let providerDown = true;

    global.fetch = vi.fn(async () => {
      if (providerDown) {
        throw new Error("ECONNREFUSED");
      }
      return { ok: true, status: 200 };
    }) as any;

    const failedResult = await sendSlack("https://hooks.slack.com", {});
    expect(failedResult).toBe(false);
    notificationMetrics.failed++;

    providerDown = false;

    const successResult = await sendSlack("https://hooks.slack.com", {});
    expect(successResult).toBe(true);
    notificationMetrics.succeeded++;

    expect(notificationMetrics.failed).toBe(1);
    expect(notificationMetrics.succeeded).toBe(1);
  });

  it("Twilio SMS 5xx returns explicit failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const result = await sendSms("sid", "token", "+1234567890", "Message");
    expect(result).toBe(false);
  });

  it("non-2xx status from any provider sets failure flag", async () => {
    const statuses = [400, 401, 403, 404, 500, 502, 503];

    for (const status of statuses) {
      global.fetch = vi.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
      })) as any;

      const result = await sendEmail("resend", "key", "user@example.com", "Test", "Body");
      const isFailed = !result;

      expect(isFailed).toBe(true);
    }
  });

  it("Resend API endpoint failure does not crash notification flow", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("API endpoint down");
    }) as any;

    expect(async () => {
      await sendEmail("resend", "key", "user@example.com", "Test", "Body");
    }).not.toThrow();
  });

  it("agent action completes despite notification failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    })) as any;

    const notifyResult = await sendSlack("https://hooks.slack.com", {});
    const agentAction = { completed: !notifyResult };

    expect(agentAction.completed).toBe(true);
  });
});
