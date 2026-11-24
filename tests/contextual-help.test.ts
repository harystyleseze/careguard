import { describe, it, expect } from "vitest";
import { AGENT_HELP_TOPICS, getAgentHelpTopic } from "../dashboard/src/lib/agent-help-content.ts";

describe("Issue #1228: Contextual In-App Help & Tooltips for Agent Tool Actions", () => {
  it("centrally defines help topics for all key agent actions", () => {
    const requiredKeys = [
      "policy_block",
      "approval_threshold",
      "drug_interaction_warning",
      "audit_flag",
      "multisig_authorization",
      "dosage_history",
    ];

    for (const key of requiredKeys) {
      expect(AGENT_HELP_TOPICS[key]).toBeDefined();
      const topic = AGENT_HELP_TOPICS[key];
      expect(topic.title).toBeTruthy();
      expect(topic.badge).toBeTruthy();
      expect(topic.whatTriggered).toBeTruthy();
      expect(topic.whatYouCanDo).toBeTruthy();
      expect(topic.category).toBeTruthy();
    }
  });

  it("provides non-technical, plain-language explanations of what triggered the action", () => {
    const policyTopic = getAgentHelpTopic("policy_block");
    expect(policyTopic.whatTriggered).toMatch(/spending limit/i);
    expect(policyTopic.whatYouCanDo).toMatch(/Spending Policy tab|Approvals/i);

    const interactionTopic = getAgentHelpTopic("drug_interaction_warning");
    expect(interactionTopic.whatTriggered).toMatch(/cross-referenced|clinical pharmacy/i);
    expect(interactionTopic.whatYouCanDo).toMatch(/doctor|pharmacist/i);

    const multisigTopic = getAgentHelpTopic("multisig_authorization");
    expect(multisigTopic.whatTriggered).toMatch(/co-caregiver|signature/i);
    expect(multisigTopic.whatYouCanDo).toMatch(/Wallet tab|co-signer/i);
  });

  it("gracefully falls back for unknown help keys", () => {
    const fallback = getAgentHelpTopic("non_existent_action");
    expect(fallback).toBeDefined();
    expect(fallback.title).toBe("Agent Contextual Information");
    expect(fallback.whatTriggered).toBeTruthy();
    expect(fallback.whatYouCanDo).toBeTruthy();
  });
});
