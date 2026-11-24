/**
 * Centralized in-app plain-language help definitions for AI Agent actions (Issue #1228).
 * Non-technical caregivers can understand what triggered the action and what steps they can take.
 */

export interface AgentHelpTopic {
  id: string;
  title: string;
  badge: string;
  whatTriggered: string;
  whatYouCanDo: string;
  category: "policy" | "interaction" | "audit" | "multisig" | "dosage";
}

export const AGENT_HELP_TOPICS: Record<string, AgentHelpTopic> = {
  policy_block: {
    id: "policy_block",
    title: "Spending Policy Protection",
    badge: "Policy Safety",
    whatTriggered:
      "The CareGuard agent paused or blocked this payment because it exceeds Rosa's daily spending limit, monthly budget, or an unverified charge pattern.",
    whatYouCanDo:
      "Review the transaction details. If this is an expected expense, you can increase the daily or monthly limit in the Spending Policy tab, or manually approve the payment in the Approvals tab.",
    category: "policy",
  },
  approval_threshold: {
    id: "approval_threshold",
    title: "Caregiver Approval Threshold",
    badge: "Manual Review",
    whatTriggered:
      "Payments greater than your configured threshold (e.g. $75) require explicit caregiver sign-off before being submitted to the Stellar blockchain.",
    whatYouCanDo:
      "Go to the Approvals tab to review the pharmacy or medical provider invoice. You can approve the transaction or decline it with a note.",
    category: "policy",
  },
  drug_interaction_warning: {
    id: "drug_interaction_warning",
    title: "Drug-to-Drug Interaction Flag",
    badge: "Clinical Alert",
    whatTriggered:
      "The agent cross-referenced Rosa's medications against clinical pharmacy safety databases and found a potential interaction or allergy conflict.",
    whatYouCanDo:
      "Review the clinical recommendation below. We advise consulting Rosa's primary care doctor or pharmacist before filling new or modified prescriptions.",
    category: "interaction",
  },
  audit_flag: {
    id: "audit_flag",
    title: "Tamper-Evident Audit Logging",
    badge: "Security Log",
    whatTriggered:
      "Every tool call, policy change, and financial payment generates a cryptographic hash logged to Rosa's immutable audit trail.",
    whatYouCanDo:
      "Caregivers can verify that transactions and dosage updates have not been altered. You can view full audit records in the Activity tab.",
    category: "audit",
  },
  multisig_authorization: {
    id: "multisig_authorization",
    title: "Multi-Signature Custody Check",
    badge: "Shared Custody",
    whatTriggered:
      "For large payments exceeding the multi-sig limit, CareGuard requires a co-caregiver's secondary cryptographic signature on the Stellar transaction before submission.",
    whatYouCanDo:
      "Notify the secondary signer or open the Wallet tab to review pending signature requests. Once co-signed, the payment automatically submits to Stellar.",
    category: "multisig",
  },
  dosage_history: {
    id: "dosage_history",
    title: "Medication Dosage Versioning",
    badge: "Adherence History",
    whatTriggered:
      "When a doctor adjusts medication strength or dosing frequency, CareGuard versions the record instead of overwriting it.",
    whatYouCanDo:
      "Inspect the timeline below to see when doses were increased or tapered. Adherence scores calculate based on the exact dosage active on each calendar day.",
    category: "dosage",
  },
};

/** Get help content by topic key with safe fallback. */
export function getAgentHelpTopic(key: string): AgentHelpTopic {
  return (
    AGENT_HELP_TOPICS[key] ?? {
      id: key,
      title: "Agent Contextual Information",
      badge: "Info",
      whatTriggered: "This element is managed by CareGuard's autonomous healthcare agent.",
      whatYouCanDo: "Review your recipient's settings or consult your healthcare provider.",
      category: "policy",
    }
  );
}
