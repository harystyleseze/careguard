/**
 * Minimal notification dispatcher.
 *
 * Today: console + optional Slack webhook (SLACK_WEBHOOK_URL).
 * Stub for #71 — when the real notification service lands, this module
 * forwards to it via the same `notify()` signature.
 */

export type NotificationLevel = "info" | "warning" | "critical";

export interface Notification {
  level: NotificationLevel;
  title: string;
  description: string;
  context?: Record<string, unknown>;
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const ICONS: Record<NotificationLevel, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export async function notify(n: Notification): Promise<void> {
  const line = `${ICONS[n.level]} [${n.level.toUpperCase()}] ${n.title} — ${n.description}`;
  if (n.level === "critical" || n.level === "warning") {
    console.warn(line);
  } else {
    console.log(line);
  }

  if (!SLACK_WEBHOOK_URL) return;

  try {
    const ctx = n.context ? `\n\n\`\`\`${JSON.stringify(n.context, null, 2)}\`\`\`` : "";
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${ICONS[n.level]} *${n.title}*\n${n.description}${ctx}`,
      }),
    });
  } catch (err: any) {
    // Notifications must never crash the caller.
    console.warn(`  ⚠ notify: failed to deliver Slack webhook: ${err?.message ?? err}`);
  }
}
