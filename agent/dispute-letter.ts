/**
 * Dispute Letter Generation Module (Issue #998)
 *
 * Self-contained formatting and persistence module for patient/caregiver billing
 * dispute letters, decoupled from core Stellar payment tools.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import {
  formatDisputeLetter,
  inferDisputeTemplate,
  type DisputeReasonTemplate,
} from "../shared/dispute-templates.ts";

export interface DisputeRecord {
  id: string;
  billId: string;
  recipientId: string;
  template: DisputeReasonTemplate;
  totalOvercharge: number;
  errorCount: number;
  letterBody: string;
  facility: string;
  caregiverName: string;
  caregiverEmail: string;
  createdAt: string;
  status: "draft" | "generated" | "sent" | "resolved";
}

export interface DisputeAuditResult {
  totalOvercharge: number;
  errorCount: number;
  lineItems: Array<{
    description: string;
    cptCode?: string;
    chargedAmount: number;
    suggestedAmount?: number;
    errorDescription?: string;
    annotation?: string;
  }>;
}

export interface DisputeRecipientInfo {
  name: string;
  facility: string;
  caregiverName: string;
  caregiverEmail: string;
}

export function generateDisputeLetter(
  billId: string,
  errorIds: string[],
  auditResult: DisputeAuditResult,
  recipientInfo: DisputeRecipientInfo,
  reason?: DisputeReasonTemplate,
  recipientId = "default"
) {
  const errorItems = auditResult.lineItems.filter(
    (item) => errorIds.length === 0 || errorIds.includes(item.description)
  );

  const templateKey: DisputeReasonTemplate =
    reason ||
    inferDisputeTemplate(
      errorItems.map((item) => ({
        errorDescription: item.errorDescription,
        description: item.description,
      }))
    );

  const emailBody = formatDisputeLetter({
    billId,
    templateKey,
    recipientInfo,
    disputedItems: errorItems,
    totalOvercharge: auditResult.totalOvercharge,
  });

  const pdf = `careguard-dispute-letter-${billId}.pdf`;

  const record: DisputeRecord = {
    id: `dispute_${Date.now()}`,
    billId,
    recipientId,
    template: templateKey,
    totalOvercharge: auditResult.totalOvercharge,
    errorCount: auditResult.errorCount,
    letterBody: emailBody,
    facility: recipientInfo.facility,
    caregiverName: recipientInfo.caregiverName,
    caregiverEmail: recipientInfo.caregiverEmail,
    createdAt: new Date().toISOString(),
    status: "generated",
  };

  return { pdf, emailBody, template: templateKey, disputeRecord: record };
}
