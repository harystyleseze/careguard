import {
  confirmAdherence,
  getAdherenceSummary,
} from "../shared/adherence.ts";

/** Agent-facing summary of adherence records for a recipient. */
export async function getAdherenceStatus(recipientId: string = "rosa") {
  const summary = await getAdherenceSummary(recipientId);
  return {
    ...summary,
    pendingReminders: summary.pendingNow.length,
    flaggedReminders: summary.flaggedRecords,
  };
}

/** Mark one adherence reminder as confirmed. */
export async function confirmAdherenceReminder(recordId: string) {
  return { success: await confirmAdherence(recordId) };
}
