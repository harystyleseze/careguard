/**
 * Cron job: send pickup reminders for medication orders that have been
 * 'ready' for more than READY_REMINDER_DAYS days without being picked up.
 *
 * Runs every 6 hours. Uses node-cron (already a dependency).
 * Import and call startOrderStatusReminderCron() from server.ts / agent/server.ts.
 */

import cron from "node-cron";
import { notify } from "./notifications.ts";
import {
  getOverdueReadyOrders,
  markReminderSent,
  READY_REMINDER_DAYS,
} from "./order-status.ts";
import { logger } from "./logger.ts";

export function startOrderStatusReminderCron(): void {
  // Runs at minute 0 of every 6th hour: 00:00, 06:00, 12:00, 18:00
  cron.schedule("0 */6 * * *", async () => {
    const overdueOrders = getOverdueReadyOrders();
    if (overdueOrders.length === 0) return;

    logger.info(
      { count: overdueOrders.length },
      "[order-reminder] sending pickup reminders",
    );

    for (const order of overdueOrders) {
      await notify({
        level: "warning",
        title: "Medication ready for pickup",
        description: `${order.drugName} from ${order.pharmacyName} has been ready for over ${READY_REMINDER_DAYS} day(s) and hasn't been picked up yet.`,
        context: {
          txId: order.txId,
          recipientId: order.recipientId,
          readySince: order.readySince,
        },
        recipientCaregiverId: "caregiver",
      });

      markReminderSent(order.txId);
    }
  });

  logger.info("[order-reminder] pickup reminder cron started (every 6 hours)");
}
