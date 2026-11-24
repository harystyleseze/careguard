import { z } from "zod";

export const BillLineItemSchema = z.object({
  description: z.string(),
  cptCode: z.string().optional(),
  quantity: z.number(),
  chargedAmount: z.number(),
  status: z.enum(["valid", "duplicate", "upcoded", "unbundled", "error"]),
  suggestedAmount: z.number().optional(),
  errorDescription: z.string().optional(),
  annotation: z.string().optional(),
});

export const BillAuditResultSchema = z.object({
  totalCharged: z.number(),
  totalCorrect: z.number(),
  totalOvercharge: z.number(),
  errorCount: z.number(),
  savingsPercent: z.number().optional(),
  lineItems: z.array(BillLineItemSchema),
  recommendation: z.string().optional(),
});

export type BillAuditResult = z.infer<typeof BillAuditResultSchema>;

export const PharmacyPriceSchema = z.object({
  pharmacyName: z.string(),
  pharmacyId: z.string().optional(),
  price: z.number(),
  distance: z.string().optional(),
  inStock: z.union([z.boolean(), z.literal("unknown")]).optional(),
});

export const PharmacyCompareResultSchema = z.object({
  drug: z.string(),
  prices: z.array(PharmacyPriceSchema),
  cheapest: PharmacyPriceSchema,
  mostExpensive: PharmacyPriceSchema.optional(),
  potentialSavings: z.number().optional(),
  savingsPercent: z.number().optional(),
});

export type PharmacyCompareResult = z.infer<typeof PharmacyCompareResultSchema>;

export const DrugInteractionSchema = z.object({
  drug1: z.string(),
  drug2: z.string(),
  severity: z.string(),
  recommendation: z.string(),
});

export const DrugInteractionResultSchema = z.object({
  summary: z.string().optional(),
  interactions: z.array(DrugInteractionSchema).optional(),
});

export type DrugInteractionResult = z.infer<typeof DrugInteractionResultSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  type: z.enum(["medication", "bill", "service_fee"]),
  description: z.string(),
  amount: z.number(),
  recipient: z.string(),
  // Always a real 64-char hex Stellar tx hash, or undefined (#14).
  stellarTxHash: z.string().optional(),
  txHashStatus: z.enum(["extracted", "extraction_failed"]).optional(),
  mppOrderId: z.string().optional(),
  pendingUntil: z.string().optional(),
  status: z.string(),
  category: z.string(),
  // Optional caregiver-authored memo for record-keeping (Feature: payment memo).
  memo: z.string().optional(),
  // Medication order fulfilment lifecycle (Feature: order tracking).
  order_status: z.enum(["submitted", "ready", "picked_up"]).optional(),
  order_status_history: z
    .array(
      z.object({
        status: z.enum(["submitted", "ready", "picked_up"]),
        timestamp: z.string(),
        updatedBy: z.string(),
      }),
    )
    .optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

export const ORDER_STATUS = {
  SUBMITTED: "submitted",
  READY: "ready",
  PICKED_UP: "picked_up",
} as const;

export const ORDER_STATUSES = [
  ORDER_STATUS.SUBMITTED,
  ORDER_STATUS.READY,
  ORDER_STATUS.PICKED_UP,
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const AuditLogSchema = z.object({
  timestamp: z.string(),
  event: z.string(),
  actor: z.string(),
  details: z.any(),
});

export type AuditLogEvent = z.infer<typeof AuditLogSchema>;

export const CategoryTotalsSchema = z.object({
  medications: z.number(),
  bills: z.number(),
  serviceFees: z.number(),
  total: z.number(),
  count: z.number(),
});

export const SpendingDataSchema = z.object({
  policy: z.object({
    dailyLimit: z.number(),
    monthlyLimit: z.number(),
    medicationMonthlyBudget: z.number(),
    billMonthlyBudget: z.number(),
    approvalThreshold: z.number(),
    holdTimeSeconds: z.number().optional().default(86400),
    warningThresholdPct: z.number().optional(),
  }),
  spending: z.object({
    medications: z.number(),
    bills: z.number(),
    serviceFees: z.number(),
    total: z.number(),
  }),
  budgetRemaining: z.object({
    medications: z.number(),
    bills: z.number(),
  }),
  transactionCount: z.number(),
  recentTransactions: z.array(TransactionSchema),
  // #1185: per-category totals per range. Optional so older agents still parse.
  categoryBreakdown: z
    .object({
      "7d": CategoryTotalsSchema,
      "30d": CategoryTotalsSchema,
      all: CategoryTotalsSchema,
    })
    .optional(),
});

export type SpendingData = z.infer<typeof SpendingDataSchema>;
export type CategoryTotals = z.infer<typeof CategoryTotalsSchema>;

export type RecipientProfile = {
  name: string;
  age?: number;
  facility?: string;
  medications?: string[];
  doctor?: string;
  insurance?: string;
  avatar?: string;
};

export type CaregiverProfile = {
  name: string;
  relationship?: string;
  location?: string;
  notifications?: string;
};

export type DisputeLetter = {
  billId: string;
  recipientName: string;
  facility: string;
  totalOvercharge: number;
  errorCount: number;
  emailText: string;
  emailHtml: string;
  generatedAt: string;
};

// ── Vitals (#1237) ────────────────────────────────────────────────────────────

export const VITAL_TYPES = ["weight", "blood_pressure", "glucose"] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

/** Default unit per vital type — mirrors services/vitals/db.ts. */
export const VITAL_DEFAULT_UNIT: Record<VitalType, string> = {
  weight: "lb",
  blood_pressure: "mmHg",
  glucose: "mg/dL",
};

export const VitalSchema = z.object({
  id: z.string(),
  recipient_id: z.string(),
  type: z.enum(VITAL_TYPES),
  value: z.number(),
  secondary_value: z.number().nullable(),
  unit: z.string(),
  timestamp: z.string(),
});

export type Vital = z.infer<typeof VitalSchema>;

export const AdherenceTimelineEventSchema = z.object({
  id: z.string(),
  drug: z.string(),
  date: z.string(),
  status: z.enum(["pending", "confirmed", "skipped", "flagged"]),
});

export type AdherenceTimelineEvent = z.infer<typeof AdherenceTimelineEventSchema>;

/** A persisted drug interaction check (#1193). */
export const InteractionCheckSchema = z.object({
  id: z.string(),
  recipient_id: z.string(),
  medications: z.array(z.string()),
  interaction_count: z.number(),
  highest_severity: z.string().nullable(),
  summary: z.string().nullable(),
  interactions: z.array(z.unknown()),
  checked_at: z.string(),
});

export type InteractionCheck = z.infer<typeof InteractionCheckSchema>;

/** A record an agent tool invocation produced, for link-through from history. */
export const AgentHistoryLinkSchema = z.object({
  kind: z.enum(["transaction", "dispute", "bill_audit", "interaction_check", "approval"]),
  id: z.string().optional(),
  label: z.string(),
  stellarTxHash: z.string().optional(),
});

export type AgentHistoryLink = z.infer<typeof AgentHistoryLinkSchema>;

/** A persisted agent tool invocation and its outcome (redacted server-side). */
export const AgentHistoryEntrySchema = z.object({
  id: z.string(),
  recipient_id: z.string(),
  run_id: z.string().nullable(),
  task: z.string().nullable(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  status: z.enum(["success", "error", "blocked", "pending"]),
  summary: z.string(),
  error: z.string().nullable(),
  links: z.array(AgentHistoryLinkSchema),
  created_at: z.string(),
});

export type AgentHistoryEntry = z.infer<typeof AgentHistoryEntrySchema>;

/** Human-readable reading, e.g. "128/82 mmHg" or "162 lb". */
export function formatVital(v: Pick<Vital, "type" | "value" | "secondary_value" | "unit">): string {
  const reading =
    v.type === "blood_pressure" && v.secondary_value != null
      ? `${v.value}/${v.secondary_value}`
      : `${v.value}`;
  return `${reading} ${v.unit}`;
}

// ── Allergies & Adverse Reactions (Issue #1230) ────────────────────────────────

export const AllergySeveritySchema = z.enum([
  'mild',
  'moderate',
  'severe',
  'life_threatening',
]);

export type AllergySeverity = z.infer<typeof AllergySeveritySchema>;

export const RecipientAllergySchema = z.object({
  id: z.string().min(1),
  substance: z.string().min(1),
  severity: AllergySeveritySchema,
  reaction: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().optional(),
});

export type RecipientAllergy = z.infer<typeof RecipientAllergySchema>;

// ── Co-Caregiver Presence (Issue #1231) ───────────────────────────────────────

export const ItemPresenceEntrySchema = z.object({
  caregiverId: z.string().min(1),
  caregiverName: z.string().min(1),
  avatar: z.string().optional(),
  lastViewedAt: z.string().min(1),
});

export type ItemPresenceEntry = z.infer<typeof ItemPresenceEntrySchema>;

export type ItemPresenceMap = Record<string, ItemPresenceEntry[]>;

// ── Linked caregivers & handoff notes (#1179, #1180) ──────────────────────────
// Mirrors services/care-recipients/db.ts.

export const CAREGIVER_ROLES = ["owner", "co-caregiver", "viewer"] as const;
export type CaregiverRole = (typeof CAREGIVER_ROLES)[number];

export const LinkedCaregiverSchema = z.object({
  caregiver_user_id: z.string().min(1),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  role: z.enum(CAREGIVER_ROLES),
  status: z.enum(["active", "invited"]),
  created_at: z.string(),
});

export type LinkedCaregiver = z.infer<typeof LinkedCaregiverSchema>;

export const HANDOFF_NOTE_MAX_LENGTH = 500;

export const HandoffNoteSchema = z.object({
  id: z.string().min(1),
  recipient_id: z.string().min(1),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
});

export type HandoffNote = z.infer<typeof HandoffNoteSchema>;

// ── Granular Data-Sharing Consent (#1218) ─────────────────────────────────────

export interface RoleConsent {
  medications: boolean;
  bills: boolean;
  wallet: boolean;
}

export interface ConsentSettings {
  owner: RoleConsent;
  "co-caregiver": RoleConsent;
  viewer: RoleConsent;
}

export const DEFAULT_CONSENT_SETTINGS: ConsentSettings = {
  owner: { medications: true, bills: true, wallet: true },
  "co-caregiver": { medications: true, bills: true, wallet: true },
  viewer: { medications: true, bills: true, wallet: true },
};

// ── Cost Splitting Ledger (#1220) ───────────────────────────────────────────

export interface CostSplitShare {
  caregiverId: string;
  caregiverName: string;
  amount: number;
  status: "owed" | "settled";
  settledAt?: string;
  settledBy?: string;
}

export interface CostSplit {
  id: string;
  transactionId: string;
  recipientId: string;
  totalAmount: number;
  payerId: string;
  payerName: string;
  description?: string;
  shares: CostSplitShare[];
  createdAt: string;
}

export interface ContributorBalance {
  fromCaregiverId: string;
  fromCaregiverName: string;
  toCaregiverId: string;
  toCaregiverName: string;
  amount: number;
}

export interface ContributorBalanceSummary {
  balances: ContributorBalance[];
  totalOwed: number;
  totalSettled: number;
}

