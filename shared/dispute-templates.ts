/**
 * Dispute Reason Templates with Statutory & Regulatory Citations (#1224)
 *
 * Implements selectable appeal templates tailored for:
 * - Duplicate billing (CMS Chapter 1 / False Claims Act)
 * - Coding error / upcoding (AMA CPT / CMS NCCI)
 * - Surprise balance billing (Federal No Surprises Act, 45 CFR § 149)
 * - Unbundling (CMS NCCI Procedure-to-Procedure edits)
 * - General discrepancy
 */

export type DisputeReasonTemplate =
  | 'duplicate_charge'
  | 'coding_error'
  | 'balance_billing'
  | 'unbundling'
  | 'general_dispute';

export const DISPUTE_REASONS: readonly DisputeReasonTemplate[] = [
  'duplicate_charge',
  'coding_error',
  'balance_billing',
  'unbundling',
  'general_dispute',
] as const;

export interface DisputeTemplateConfig {
  id: DisputeReasonTemplate;
  title: string;
  legalBasis: string[];
  summaryClause: string;
  demandedRemedy: string;
}

export const DISPUTE_TEMPLATES: Record<DisputeReasonTemplate, DisputeTemplateConfig> = {
  duplicate_charge: {
    id: 'duplicate_charge',
    title: 'Formal Dispute of Duplicate Medical Charges',
    legalBasis: [
      'CMS Claims Processing Manual (Pub. 100-04) Chapter 1, Section 120 (Duplicate Claims)',
      'Federal False Claims Act (31 U.S.C. § 3729) prohibition against duplicate submissions',
    ],
    summaryClause:
      'Our audit identified identical CPT codes and procedure descriptions billed multiple times for the same patient and date of service without appropriate distinct procedural modifiers (e.g., Modifier 59/XE).',
    demandedRemedy:
      'We demand immediate removal of all redundant billing instances and an updated zero-balance statement for the duplicate items.',
  },
  coding_error: {
    id: 'coding_error',
    title: 'Dispute of Procedural Coding Discrepancy & Upcoding',
    legalBasis: [
      'American Medical Association (AMA) CPT Coding Guidelines and Medical Decision Making (MDM) Criteria',
      'CMS National Correct Coding Initiative (NCCI) Policy Manual Chapter 1',
      'CMS Physician Fee Schedule (PFS) Fair-Market Reimbursement Schedules',
    ],
    summaryClause:
      'Our audit identified procedural upcoding where billed high-complexity codes exceed the documented clinical service level, as well as significant variance from CMS fair market reimbursement benchmarks.',
    demandedRemedy:
      'We demand that the procedural codes be corrected to accurately reflect the documented level of service and that the charges be reduced to the fair-market rates itemized below.',
  },
  balance_billing: {
    id: 'balance_billing',
    title: 'Dispute of Unlawful Surprise Balance Billing',
    legalBasis: [
      'No Surprises Act (Consolidated Appropriations Act of 2021, Public Law 116-260, Title I)',
      '45 CFR § 149.410 (Balance Billing Protections for Emergency Services)',
      '45 CFR § 149.420 (Balance Billing Protections for Non-Emergency Services at In-Network Facilities)',
    ],
    summaryClause:
      'Under the federal No Surprises Act, patients are protected from surprise balance billing for emergency services and non-emergency services provided by out-of-network clinicians at in-network healthcare facilities. Cost-sharing must not exceed the in-network qualifying payment amount (QPA).',
    demandedRemedy:
      'We demand that all out-of-network balance billing charges above the statutory in-network rate be rescinded immediately in accordance with 45 CFR § 149.',
  },
  unbundling: {
    id: 'unbundling',
    title: 'Dispute of Unbundled Laboratory & Service Charges',
    legalBasis: [
      'CMS National Correct Coding Initiative (NCCI) Procedure-to-Procedure (PTP) Edits',
      'Medicare Claims Processing Manual Chapter 16 (Laboratory Services)',
    ],
    summaryClause:
      'Our audit revealed that component services and laboratory tests were billed separately ("unbundled") when they are statutorily required to be billed under a single comprehensive panel code.',
    demandedRemedy:
      'We demand that these unbundled charges be consolidated into their corresponding comprehensive panel codes and adjusted to the bundled fair-market fee.',
  },
  general_dispute: {
    id: 'general_dispute',
    title: 'Formal Notice of Medical Bill Discrepancy & Overcharges',
    legalBasis: [
      'CMS Hospital Price Transparency Guidelines (45 CFR Part 180)',
      'Fair-Market Medical Pricing Standards based on Regional CMS Fee Schedules',
    ],
    summaryClause:
      'An independent line-item audit of this medical bill revealed material discrepancies and overcharges when compared with regional CMS fair market benchmarks.',
    demandedRemedy:
      'We request a prompt review of the itemized discrepancies and an adjustment of the total charges to reflect the fair-market rates.',
  },
};

export const DISPUTE_REASON_TEMPLATES = DISPUTE_REASONS;

/**
 * Automatically infers the most appropriate dispute template from line items or finding descriptions.
 * Time Complexity: O(N) where N is number of findings.
 */
export function inferDisputeTemplate(
  itemsOrDescriptions: Array<
    | string
    | { status?: string; errorDescription?: string; description?: string; reason?: string }
  >,
): DisputeReasonTemplate {
  if (!itemsOrDescriptions || itemsOrDescriptions.length === 0) {
    return 'general_dispute';
  }

  for (const item of itemsOrDescriptions) {
    const text = (
      typeof item === 'string'
        ? item
        : `${item.status || ''} ${item.errorDescription || ''} ${item.description || ''} ${item.reason || ''}`
    ).toLowerCase();

    if (text.includes('duplicate')) {
      return 'duplicate_charge';
    }
    if (text.includes('unbundle') || text.includes('panel')) {
      return 'unbundling';
    }
    if (text.includes('balance') || text.includes('out-of-network') || text.includes('surprise') || text.includes('nsa') || text.includes('no surprises')) {
      return 'balance_billing';
    }
    if (text.includes('upcode') || text.includes('coding') || text.includes('cpt') || text.includes('modifier')) {
      return 'coding_error';
    }
  }

  return 'general_dispute';
}

export interface DisputeLetterOptions {
  hospitalName?: string;
  patientName?: string;
  accountNumber?: string;
  dateOfService?: string;
  totalBilled?: number;
  correctedAmount?: number;
  billId?: string;
  recipientInfo?: {
    name?: string;
    facility?: string;
    caregiverName?: string;
    caregiverEmail?: string;
  };
  disputedItems?: Array<{
    cptCode?: string;
    description: string;
    chargedAmount: number;
    expectedAmount?: number;
    suggestedAmount?: number;
    reason?: string;
    errorDescription?: string | null;
  }>;
  totalOvercharge?: number;
}

export function formatDisputeLetter(
  templateKey: DisputeReasonTemplate,
  options: DisputeLetterOptions,
): string {
  const template = DISPUTE_TEMPLATES[templateKey] || DISPUTE_TEMPLATES.general_dispute;
  const hospital = options.hospitalName || options.recipientInfo?.facility || 'Healthcare Facility';
  const patient = options.patientName || options.recipientInfo?.name || 'Care Recipient';
  const accountRef = options.accountNumber || (options.billId ? `#${options.billId}` : 'N/A');
  const dateStr = options.dateOfService || new Date().toISOString().split('T')[0];
  const items = options.disputedItems || [];
  const totalBilled = options.totalBilled ?? items.reduce((sum, i) => sum + i.chargedAmount, 0);
  const totalExpected =
    options.correctedAmount ??
    items.reduce((sum, i) => sum + (i.expectedAmount ?? i.suggestedAmount ?? 0), 0);
  const totalDisputed =
    options.totalOvercharge ?? (totalBilled > totalExpected ? totalBilled - totalExpected : totalBilled);

  const lines: string[] = [
    `FORMAL WRITTEN DISPUTE OF MEDICAL BILL`,
    `Subject: ${template.title}`,
    `Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    ``,
    `ATTN: Billing & Patient Financial Services`,
    `${hospital}`,
    ``,
    `Patient Name: ${patient}`,
    `Account / Reference Number: ${accountRef}`,
    `Date(s) of Service: ${dateStr}`,
    `Total Amount Billed: $${totalBilled.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Corrected / Fair-Market Amount: $${totalExpected.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Total Disputed Balance: $${totalDisputed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ``,
    `Dear Billing Supervisor,`,
    ``,
    `I am writing to formally dispute the medical billing charges referenced above on behalf of ${patient}.`,
    ``,
    `GROUNDS FOR DISPUTE:`,
    template.summaryClause,
    ``,
    `APPLICABLE STATUTES & REGULATIONS:`,
    ...template.legalBasis.map((law) => `• ${law}`),
    ``,
    `ITEMIZED DISPUTED CHARGES:`,
  ];

  for (const item of items) {
    const exp = item.expectedAmount ?? item.suggestedAmount;
    lines.push(
      `• ${item.description}${item.cptCode ? ` (CPT: ${item.cptCode})` : ''}: Billed $${item.chargedAmount.toFixed(2)}${exp !== undefined ? ` | Allowable: $${exp.toFixed(2)}` : ''}`
    );
    if (item.reason || item.errorDescription) {
      lines.push(`  Finding: ${item.reason || item.errorDescription}`);
    }
  }

  lines.push(
    ``,
    `DEMANDED REMEDY:`,
    template.demandedRemedy,
    ``,
    `Please place this account on administrative hold immediately and suspend any collection actions during the dispute review period. Kindly furnish an updated itemized statement and written response within thirty (30) calendar days.`,
    ``,
    `Sincerely,`,
    options.recipientInfo?.caregiverName || options.patientName || 'Authorized Caregiver',
    options.recipientInfo?.caregiverEmail || 'Caregiver Contact'
  );

  return lines.join('\n');
}

export function formatDisputeHtml(
  templateKey: DisputeReasonTemplate,
  options: DisputeLetterOptions,
): string {
  const textLetter = formatDisputeLetter(templateKey, options);
  const template = DISPUTE_TEMPLATES[templateKey] || DISPUTE_TEMPLATES.general_dispute;
  const hospital = options.hospitalName || options.recipientInfo?.facility || 'Healthcare Facility';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${template.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    h1 { font-size: 20px; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    .badge { display: inline-block; padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 4px; font-weight: 600; font-size: 12px; margin-bottom: 16px; }
    pre { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; white-space: pre-wrap; font-family: inherit; }
  </style>
</head>
<body>
  <h1>${template.title}</h1>
  <div class="badge">${hospital}</div>
  <pre>${textLetter}</pre>
</body>
</html>`;
}
