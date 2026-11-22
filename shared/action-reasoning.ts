/**
 * Plain-language reasoning traces for significant agent actions (#1235).
 *
 * Caregivers saw what the agent did (a bill paid, a purchase blocked, an
 * interaction flagged) but not why. At the end of each run this turns the
 * run's tool calls into a short structured summary per significant action:
 * which tools ran, in plain words, and the key numbers behind the decision.
 * It never stores raw tool-call JSON, and every string is redacted with
 * shared/redact.ts before it is persisted (see shared/agent-state.ts).
 */

import { redactPII, redactString } from "./redact.ts";

export type ReasoningActionKind =
  | "payment_completed"
  | "payment_pending_approval"
  | "payment_blocked"
  | "payment_failed"
  | "interaction_flagged"
  | "bill_audit_flagged";

export interface ReasoningStep {
  tool: string;
  /** One plain-language sentence about what the tool found. */
  summary: string;
}

export interface ReasoningDataPoint {
  label: string;
  value: string;
}

export interface ActionReasoning {
  id: string;
  runId: string;
  createdAt: string;
  kind: ReasoningActionKind;
  /** Short headline, e.g. "Bill payment held for your approval". */
  title: string;
  /** Plain-language explanation of the outcome. */
  outcome: string;
  /** Tools the agent ran leading up to (and including) this action, in order. */
  steps: ReasoningStep[];
  dataPoints: ReasoningDataPoint[];
  /** Set for payment actions so the activity/bills views can attach the trace. */
  transactionId?: string;
  /** The LLM tool-call id of the action, so in-session results can be matched. */
  toolCallId?: string;
  tool: string;
}

export interface ToolCallRecord {
  id?: string;
  tool: string;
  input: Record<string, unknown>;
  result: any;
}

export interface ReasoningPolicyContext {
  dailyLimit?: number;
  monthlyLimit?: number;
  approvalThreshold?: number;
  medicationMonthlyBudget?: number;
  billMonthlyBudget?: number;
}

/** Earlier tool calls in the run shown as context for one action. */
const MAX_CONTEXT_STEPS = 8;

const TOOL_LABELS: Record<string, string> = {
  compare_pharmacy_prices: "Compared pharmacy prices",
  audit_medical_bill: "Audited a medical bill",
  fetch_and_audit_bill: "Fetched and audited the bill",
  fetch_rosa_bill: "Fetched the bill",
  check_drug_interactions: "Checked drug interactions",
  check_allergies: "Checked recorded allergies",
  check_spending_policy: "Checked the spending policy",
  get_spending_summary: "Reviewed spending so far",
  get_wallet_balance: "Checked the wallet balance",
  pay_for_medication: "Paid for medication",
  pay_bill: "Paid a bill",
  generate_dispute_letter: "Drafted a dispute letter",
  get_adherence_status: "Checked medication adherence",
  get_handoff_notes: "Read caregiver handoff notes",
  run_price_watch: "Ran a price watch",
};

function usd(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value);
}

function errorText(result: any): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  if (typeof result.error === "string") return result.error;
  if (result.ok === false && typeof result.message === "string") return result.message;
  if (result.ok === false && typeof result.reason === "string") return result.reason;
  return undefined;
}

/** Strip the agent's shouty machine prefixes so the reason reads as a sentence. */
function plainReason(error: string): string {
  return error
    .replace(/^BLOCKED BY SPENDING POLICY:\s*/i, "")
    .replace(/^REQUIRES CAREGIVER APPROVAL:\s*/i, "")
    .replace(/^REQUIRES CO-SIGNER MULTI-SIG:\s*/i, "")
    .trim()
    // Outcome sentences add their own full stop.
    .replace(/[.\s]+$/, "");
}

/** One plain-language sentence for any tool call. */
export function describeToolCall(call: ToolCallRecord): string {
  const r = call.result;
  const err = errorText(r);
  const label = TOOL_LABELS[call.tool] ?? `Ran ${call.tool.replace(/_/g, " ")}`;

  switch (call.tool) {
    case "compare_pharmacy_prices": {
      if (err || !Array.isArray(r?.prices)) break;
      const drug = r.drug ?? call.input.drug_name ?? "the medication";
      let text = `Compared ${drug} prices at ${r.prices.length} pharmac${r.prices.length === 1 ? "y" : "ies"}`;
      if (r.cheapest) text += `; cheapest was ${r.cheapest.pharmacyName} at ${usd(r.cheapest.price)}`;
      if (r.network?.configured && r.network.outOfNetworkCount > 0) text += `. ${r.network.explanation}`;
      return `${text}.`.replace(/\.\.$/, ".");
    }
    case "audit_medical_bill":
    case "fetch_and_audit_bill": {
      if (err || typeof r?.errorCount !== "number") break;
      let text =
        r.errorCount > 0
          ? `Audited the bill and found ${r.errorCount} error${r.errorCount === 1 ? "" : "s"} worth ${usd(r.totalOvercharge)}; corrected total ${usd(r.totalCorrect)} of ${usd(r.totalCharged)} charged`
          : `Audited the bill (${usd(r.totalCharged)}) and found no billing errors`;
      const oon = (r.findings ?? []).find((f: any) => f?.type === "out_of_network_provider");
      if (oon) text += `; ${oon.providerName} is out-of-network`;
      return `${text}.`;
    }
    case "check_drug_interactions": {
      if (err) break;
      const meds = Array.isArray(call.input.medications) ? (call.input.medications as string[]).join(", ") : "the medications";
      const count = Array.isArray(r?.interactions) ? r.interactions.length : 0;
      if (count === 0) return `Checked ${meds} for interactions and found none.`;
      const verdict = r.decision === "block" ? "serious enough to stop and flag" : "below the blocking threshold, so noted as a warning";
      return `Checked ${meds} and found ${count} interaction${count === 1 ? "" : "s"}, ${verdict} (threshold: ${r.blockingThreshold ?? "any"}).`;
    }
    case "check_spending_policy": {
      if (err || typeof r !== "object" || r === null) break;
      if (r.allowed === false) return `The spending policy would not allow this payment: ${r.reason ?? "limit reached"}.`;
      if (r.requiresApproval) return "The spending policy allows this payment but requires caregiver approval first.";
      if (r.allowed === true) return "The spending policy allows this payment.";
      break;
    }
    case "get_spending_summary": {
      if (err || !r?.spending) break;
      return `Reviewed spending so far: ${usd(r.spending.total)} total (medications ${usd(r.spending.medications)}, bills ${usd(r.spending.bills)}).`;
    }
    case "get_wallet_balance": {
      if (err || !r?.balances) break;
      return `Checked the wallet: ${r.balances.usdc} USDC available.`;
    }
    case "pay_for_medication":
    case "pay_bill":
      return describePaymentOutcome(call).outcome;
  }
  return err ? `${label}, but it failed: ${err.replace(/[.\s]+$/, "")}.` : `${label}.`;
}

function paymentKind(call: ToolCallRecord): ReasoningActionKind {
  const r = call.result;
  if (r?.success) return "payment_completed";
  const err = errorText(r) ?? "";
  if (r?.multisigPending || /REQUIRES (CAREGIVER APPROVAL|CO-SIGNER)/i.test(err) || r?.transaction?.status === "pending") {
    return "payment_pending_approval";
  }
  if (/BLOCKED/i.test(err) || r?.transaction?.status === "blocked") return "payment_blocked";
  return "payment_failed";
}

function describePaymentOutcome(call: ToolCallRecord): { kind: ReasoningActionKind; title: string; outcome: string } {
  const r = call.result;
  const isBill = call.tool === "pay_bill";
  const what = isBill
    ? `the ${usd(call.input.amount ?? r?.transaction?.amount)} bill from ${call.input.provider_name ?? "the provider"}`
    : `${call.input.drug_name ?? "the medication"} (${usd(call.input.amount ?? r?.transaction?.amount)}) from ${call.input.pharmacy_name ?? "the pharmacy"}`;
  const kind = paymentKind(call);
  const reason = plainReason(errorText(r) ?? "");
  switch (kind) {
    case "payment_completed":
      return {
        kind,
        title: isBill ? "Bill paid" : "Medication purchased",
        outcome: `Paid ${what}. It was within the spending policy, so no approval was needed.`,
      };
    case "payment_pending_approval":
      return {
        kind,
        title: isBill ? "Bill payment held for approval" : "Medication purchase held for approval",
        outcome: `Held ${what} for a caregiver's approval instead of paying it: ${reason || "it is above the approval threshold"}.`,
      };
    case "payment_blocked":
      return {
        kind,
        title: isBill ? "Bill payment blocked" : "Medication purchase blocked",
        outcome: `Did not pay ${what} because the spending policy blocked it: ${reason || "a limit was reached"}. No money moved.`,
      };
    default:
      return {
        kind,
        title: isBill ? "Bill payment failed" : "Medication purchase failed",
        outcome: `Tried to pay ${what}, but it failed: ${reason || "unknown error"}. No money moved.`,
      };
  }
}

function paymentDataPoints(call: ToolCallRecord, policy?: ReasoningPolicyContext): ReasoningDataPoint[] {
  const r = call.result;
  const points: ReasoningDataPoint[] = [];
  const amount = call.input.amount ?? r?.transaction?.amount;
  if (amount !== undefined) points.push({ label: "Amount", value: usd(amount) });
  if (policy?.approvalThreshold !== undefined) points.push({ label: "Approval threshold", value: usd(policy.approvalThreshold) });
  if (policy?.dailyLimit !== undefined) points.push({ label: "Daily limit", value: usd(policy.dailyLimit) });
  const budget = call.tool === "pay_bill" ? policy?.billMonthlyBudget : policy?.medicationMonthlyBudget;
  if (budget !== undefined) {
    points.push({ label: call.tool === "pay_bill" ? "Monthly bill budget" : "Monthly medication budget", value: usd(budget) });
  }
  if (r?.transaction?.status) points.push({ label: "Status", value: String(r.transaction.status) });
  return points;
}

function interactionDataPoints(call: ToolCallRecord): ReasoningDataPoint[] {
  const r = call.result;
  const points: ReasoningDataPoint[] = [];
  for (const interaction of (r?.interactions ?? []).slice(0, 5)) {
    const pair = Array.isArray(interaction.drugs) ? interaction.drugs.join(" + ") : "";
    points.push({
      label: pair || "Interaction",
      value: [interaction.severity, interaction.description ?? interaction.recommendation].filter(Boolean).join(" — "),
    });
  }
  if (r?.blockingThreshold) points.push({ label: "Blocking threshold", value: String(r.blockingThreshold) });
  return points;
}

function auditDataPoints(call: ToolCallRecord): ReasoningDataPoint[] {
  const r = call.result;
  const points: ReasoningDataPoint[] = [
    { label: "Charged", value: usd(r.totalCharged) },
    { label: "Overcharges found", value: usd(r.totalOvercharge) },
    { label: "Corrected total", value: usd(r.totalCorrect) },
  ];
  for (const item of (r.lineItems ?? []).filter((i: any) => i?.status && i.status !== "valid").slice(0, 5)) {
    points.push({ label: item.description ?? item.cptCode ?? "Line item", value: item.errorDescription ?? item.status });
  }
  for (const finding of (r.findings ?? []).filter((f: any) => f?.type === "out_of_network_provider")) {
    points.push({ label: "Out-of-network provider", value: `${finding.providerName} (${usd(finding.amountAtRisk)} at risk)` });
  }
  return points;
}

function isSignificant(call: ToolCallRecord): boolean {
  const r = call.result;
  if (call.tool === "pay_for_medication" || call.tool === "pay_bill") return true;
  if (call.tool === "check_drug_interactions") {
    return !errorText(r) && Array.isArray(r?.interactions) && r.interactions.length > 0;
  }
  if (call.tool === "audit_medical_bill" || call.tool === "fetch_and_audit_bill") {
    if (errorText(r) || typeof r?.errorCount !== "number") return false;
    return r.errorCount > 0 || (r.findings ?? []).some((f: any) => f?.type === "out_of_network_provider");
  }
  return false;
}

function redactText(value: string): string {
  return redactPII(redactString(value));
}

/** Redacts every caregiver-visible string with shared/redact.ts. */
export function redactReasoning(entry: ActionReasoning): ActionReasoning {
  return {
    ...entry,
    title: redactText(entry.title),
    outcome: redactText(entry.outcome),
    steps: entry.steps.map((step) => ({ tool: step.tool, summary: redactText(step.summary) })),
    dataPoints: entry.dataPoints.map((point) => ({ label: redactText(point.label), value: redactText(point.value) })),
  };
}

/**
 * Builds one redacted reasoning entry per significant action in a run. The
 * steps for an action are the tool calls that ran before it in the same run
 * (the data the agent had in hand), followed by the action itself.
 */
export function buildActionReasonings(params: {
  runId: string;
  toolCalls: readonly ToolCallRecord[];
  policy?: ReasoningPolicyContext;
  now?: Date;
}): ActionReasoning[] {
  const createdAt = (params.now ?? new Date()).toISOString();
  const entries: ActionReasoning[] = [];

  params.toolCalls.forEach((call, index) => {
    if (!isSignificant(call)) return;
    const context = params.toolCalls.slice(Math.max(0, index - MAX_CONTEXT_STEPS), index);
    const steps = [...context, call].map((c) => ({ tool: c.tool, summary: describeToolCall(c) }));

    let kind: ReasoningActionKind;
    let title: string;
    let outcome: string;
    let dataPoints: ReasoningDataPoint[];
    if (call.tool === "pay_for_medication" || call.tool === "pay_bill") {
      ({ kind, title, outcome } = describePaymentOutcome(call));
      dataPoints = paymentDataPoints(call, params.policy);
    } else if (call.tool === "check_drug_interactions") {
      kind = "interaction_flagged";
      const blocking = call.result?.decision === "block";
      title = blocking ? "Drug interaction flagged" : "Drug interaction noted";
      outcome = blocking
        ? `Flagged an interaction at or above the ${call.result?.blockingThreshold ?? "configured"} severity threshold. Review it with a doctor or pharmacist before changing medications.`
        : `Found an interaction below the ${call.result?.blockingThreshold ?? "configured"} blocking threshold, so it was recorded as a warning rather than stopping anything.`;
      dataPoints = interactionDataPoints(call);
    } else {
      kind = "bill_audit_flagged";
      title = "Bill flagged by audit";
      outcome = describeToolCall(call) + (call.result?.recommendation ? ` ${call.result.recommendation}` : "");
      dataPoints = auditDataPoints(call);
    }

    const transactionId = call.result?.transaction?.id;
    entries.push(
      redactReasoning({
        id: `${params.runId}:${index}`,
        runId: params.runId,
        createdAt,
        kind,
        title,
        outcome,
        steps,
        dataPoints,
        tool: call.tool,
        ...(typeof transactionId === "string" ? { transactionId } : {}),
        ...(call.id ? { toolCallId: call.id } : {}),
      }),
    );
  });

  return entries;
}
